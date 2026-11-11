/**
 * What a page renders, and whether its internal links reach a page, for the
 * pre-publish checks. One implementation, shared by the publish dialog's
 * preflight (apps/server) and the publish worker's gate (apps/worker), so the
 * dialog never calls a publish "allowed" that the worker then rejects.
 *
 * SERVER-ONLY: this parses Markdown/MDX with remark. The reader must never
 * import it; it imports only `./site-route`, which holds the route logic both
 * sides share.
 *
 * - Content is read from the parsed tree, not by scanning lines: a link counts
 *   only when it renders as one. Code, comments, MDX expressions and discarded
 *   HTML contexts render no link. Only literal hrefs on JSX/HTML elements the
 *   reader renders as links count as attribute destinations.
 *   Reference links resolve through their definition (CommonMark: the first
 *   definition of a label wins); a definition nothing uses renders nothing.
 * - A link is rendered as the reader renders it (relative to the page URL, or
 *   root-relative with the page's version prefix and language), then resolved
 *   with `resolveSiteRoute`, the reader's own route order, following redirects.
 */
import { createHash } from 'node:crypto';
import type { Root } from 'mdast';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { MAX_REDIRECT_CHAIN_LENGTH } from './redirects';
import { publicLanguages, type SiteSnapshot, type SnapshotPage } from './site';
import { resolveSiteRoute, sitePathTooLong } from './site-route';

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Served by their own routes, not the page route: the changelog and generated files. */
const RESERVED_ROUTES = new Set(['changelog', 'sitemap.xml', 'robots.txt', 'llms.txt', 'llms-full.txt']);
/** A page's Markdown or HTML twin resolves to the page itself. */
const PAGE_EXTENSION = /\.(?:mdx?|html)$/i;
/** Anything else with an extension is a file (image, PDF, archive), not a page. */
const FILE_EXTENSION = /\.[a-z0-9]{2,8}$/i;

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const objectValue = (value: unknown): Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]' ? (value as Record<string, unknown>) : {};

/**
 * Whether publishing enforces the broken-link check for this snapshot: the
 * CI-checks umbrella and the broken-links add-on are both on (each defaults to
 * on) in the snapshot's DELIVERED add-on state.
 *
 * The snapshot's `project.config.addons` is the plan projection built by
 * `buildSnapshot` + `projectAddonRowsForDelivery`: an add-on the site's plan
 * doesn't deliver reads as off even when its stored row is on. That is the
 * state the publish worker has always gated on, and the dialog must match it,
 * so this takes the snapshot rather than a raw stored `project.config`.
 */
export const brokenLinkCheckEnabledForSnapshot = (snapshot: SiteSnapshot): boolean => {
  const addons = objectValue(objectValue(snapshot.project.config).addons);
  return addons.ciChecks !== false && addons.brokenLinks !== false;
};

/* ------------------------------------------------------------------------ */
/* Page content, from the parsed tree                                        */
/* ------------------------------------------------------------------------ */

type JsxAttribute = { type: string; name?: string; value?: unknown };
type MarkdownNode = {
  type: string;
  value?: string;
  url?: string;
  alt?: string | null;
  identifier?: string;
  name?: string | null;
  attributes?: JsxAttribute[];
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

/** What one page renders that the checks look at. */
export interface PageContentFacts {
  /** Destinations of links that render, in document order. */
  links: string[];
  /** Sources of images that render without alt text. */
  imagesWithoutAlt: string[];
  /** Stray text left over from imports: a paragraph of only `/` or a literal `---`. */
  strayText: string[];
}

// The same parse as #426's link rewriter (micromark MDX + mdast-util-mdx, via
// remark-mdx). GFM is left out on purpose: it roughly doubles the cost and
// changes nothing the checks read (links in table cells parse the same, its
// autolink literals are external), except footnotes, handled below.
const mdxParser = unified().use(remarkParse).use(remarkMdx);
// The reader renders CommonMark (+ GFM): what it treats as code (indented code
// included, which MDX disables) comes from this parse, and invalid MDX is read
// with it entirely, where JSX and comments are raw HTML.
const markdownParser = unified().use(remarkParse);
// Fallback links use the reader's CommonMark/GFM -> HAST -> parse5 pipeline.
const htmlParser = unified().use(remarkParse).use(remarkGfm).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
/** Without GFM a footnote (`[^1]` with `[^1]: text`) parses as a reference
 *  link; the reader renders it as an in-page footnote, never a page link. */
const isFootnoteLabel = (identifier: string | undefined): boolean => identifier?.startsWith('^') === true;

/** Excluded from the MDX walk; fallback HTML links are collected separately. */
const SILENT = new Set(['code', 'inlineCode', 'html', 'mdxFlowExpression', 'mdxTextExpression', 'mdxjsEsm', 'yaml', 'toml']);
// `site/mdx/component-map.tsx` renders these components as anchors, alongside
// the reader's plain <a>. HTML parsing makes tag/attribute names case-insensitive.
const LINK_ELEMENTS = new Set(['a', 'card', 'button', 'relatedcard']);
const NON_LINK_CONTEXTS = new Set(['script', 'textarea', 'template', 'style', 'noscript', 'iframe', 'title']);
const STRAY = /^(?:\/|-{3,})$/;
const HTML_IMAGE = /<img\b[^>]*>/gi;
const HTML_STRAY_PARAGRAPH = /<p>\s*(\/|-{3,})\s*<\/p>/gi;

const textOf = (node: MarkdownNode): string => (node.type === 'text' ? (node.value ?? '') : (node.children ?? []).map(textOf).join(''));

const jsxAttribute = (node: MarkdownNode, name: string): JsxAttribute | undefined =>
  node.attributes?.find((attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name === name);

type HtmlNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HtmlNode[];
  position?: { start: { offset?: number } };
};

/** CommonMark may end a raw HTML node at a blank line inside e.g. <title>.
 * Keep the source HTML context even if rehype-raw reparents generated nodes. */
const htmlNonLinkRanges = (tree: Root, content: string): { start: number; end: number }[] => {
  const masked = content.split('');
  const maskCode = (node: MarkdownNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if ((node.type === 'code' || node.type === 'inlineCode') && start !== undefined && end !== undefined) masked.fill(' ', start, end);
    else for (const child of node.children ?? []) maskCode(child);
  };
  maskCode(tree);
  const ranges: { start: number; end: number }[] = [];
  const visit = (node: DefaultTreeAdapterTypes.ChildNode) => {
    if ('tagName' in node && NON_LINK_CONTEXTS.has(node.tagName) && node.sourceCodeLocation) {
      ranges.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset });
      return;
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  for (const child of parseFragment(masked.join(''), { sourceCodeLocationInfo: true }).childNodes) visit(child);
  return ranges;
};

/** Link destinations after HTML parsing, never text that merely looks like a tag. */
const htmlLinks = (tree: Root, content: string): string[] => {
  const links: string[] = [];
  const suppressed = htmlNonLinkRanges(tree, content);
  const visit = (node: HtmlNode) => {
    if (node.tagName && NON_LINK_CONTEXTS.has(node.tagName)) return;
    if (node.tagName && LINK_ELEMENTS.has(node.tagName)) {
      const offset = node.position?.start.offset;
      if (offset !== undefined && suppressed.some((range) => offset >= range.start && offset < range.end)) return;
      const properties = node.properties ?? {};
      const href = properties.href;
      // In fallback HTML, parse5 retains an authored JSX spread as an attribute.
      const spread = Object.keys(properties).some((name) => name.startsWith('{'));
      if (!spread && typeof href === 'string' && !href.trimStart().startsWith('{')) links.push(href);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(htmlParser.runSync(tree));
  return links;
};

/** Raw `<img>` tags (as rehype-raw renders them) without a usable alt. */
const htmlImagesWithoutAlt = (html: string): string[] =>
  [...html.matchAll(HTML_IMAGE)].flatMap(([tag]) => {
    const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (alt && (alt[1] ?? alt[2] ?? '').trim()) return [];
    return [
      /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i
        .exec(tag)
        ?.slice(1)
        .find((value) => value !== undefined) ?? '',
    ];
  });

const collectFacts = (content: string): PageContentFacts => {
  let tree: MarkdownNode;
  let isMdx = true;
  try {
    tree = mdxParser.parse(content) as MarkdownNode;
  } catch {
    tree = htmlParser.parse(content) as MarkdownNode;
    isMdx = false;
  }
  // Code ranges as the reader sees them. Only needed when the MDX parse may have
  // read indented code as prose (a line indented by four spaces or a tab).
  const codeRanges: { start: number; end: number }[] = [];
  if (isMdx && /^(?: {4}|\t)/m.test(content)) {
    const collectCode = (node: MarkdownNode) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if ((node.type === 'code' || node.type === 'inlineCode') && start !== undefined && end !== undefined) codeRanges.push({ start, end });
      else for (const child of node.children ?? []) collectCode(child);
    };
    collectCode(markdownParser.parse(content) as MarkdownNode);
  }
  const inCode = (node: MarkdownNode): boolean => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    return start !== undefined && end !== undefined && codeRanges.some((range) => start >= range.start && end <= range.end);
  };

  // CommonMark: the first definition of a label wins.
  const definitions = new Map<string, string>();
  const collectDefinitions = (node: MarkdownNode) => {
    if (SILENT.has(node.type) || inCode(node) || NON_LINK_CONTEXTS.has(node.name?.toLowerCase() ?? '')) return;
    if (
      node.type === 'definition' &&
      node.identifier &&
      !isFootnoteLabel(node.identifier) &&
      node.url !== undefined &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node.url);
    }
    for (const child of node.children ?? []) collectDefinitions(child);
  };
  collectDefinitions(tree);

  const facts: PageContentFacts = { links: [], imagesWithoutAlt: [], strayText: [] };
  // Inside a lowercase JSX element (`<div>`, `<p>`), as #426: the reader renders
  // it as raw HTML, where Markdown links are not links.
  const visit = (node: MarkdownNode, linksRender: boolean) => {
    if (inCode(node) || NON_LINK_CONTEXTS.has(node.name?.toLowerCase() ?? '')) return;
    if (SILENT.has(node.type)) {
      if (node.type === 'html' && !node.value?.trimStart().startsWith('<!--')) {
        facts.imagesWithoutAlt.push(...htmlImagesWithoutAlt(node.value ?? ''));
        for (const [, text] of (node.value ?? '').matchAll(HTML_STRAY_PARAGRAPH)) if (text) facts.strayText.push(text.startsWith('-') ? '---' : '/');
      }
      return;
    }
    switch (node.type) {
      case 'link':
        if (linksRender && node.url) facts.links.push(node.url);
        break;
      case 'linkReference': {
        const url = node.identifier ? definitions.get(node.identifier) : undefined;
        if (linksRender && url) facts.links.push(url);
        break;
      }
      case 'image':
        if (!node.alt?.trim()) facts.imagesWithoutAlt.push(node.url ?? '');
        break;
      case 'imageReference': {
        // Without a definition it renders as text, not an image.
        const url = node.identifier ? definitions.get(node.identifier) : undefined;
        if (url !== undefined && !node.alt?.trim()) facts.imagesWithoutAlt.push(url);
        break;
      }
      case 'paragraph': {
        const text = textOf(node).trim();
        if (STRAY.test(text)) facts.strayText.push(text.startsWith('-') ? '---' : '/');
        break;
      }
      case 'mdxJsxFlowElement':
      case 'mdxJsxTextElement': {
        if (
          LINK_ELEMENTS.has(node.name?.toLowerCase() ?? '') &&
          !node.attributes?.some((attribute) => attribute.type === 'mdxJsxExpressionAttribute')
        ) {
          const href = node.attributes?.find((attribute) => attribute.type === 'mdxJsxAttribute' && attribute.name?.toLowerCase() === 'href')?.value;
          if (typeof href === 'string') facts.links.push(href);
        }
        if (node.name === 'img') {
          const alt = jsxAttribute(node, 'alt');
          // `alt={expression}` is authored on purpose; only a missing or blank alt is flagged.
          const altText = typeof alt?.value === 'string' ? alt.value : alt?.value ? 'expression' : '';
          if (!altText.trim()) {
            const src = jsxAttribute(node, 'src')?.value;
            facts.imagesWithoutAlt.push(typeof src === 'string' ? src : '');
          }
        }
        const lowercase = Boolean(node.name && /^[a-z]/.test(node.name));
        for (const child of node.children ?? []) visit(child, linksRender && !lowercase);
        return;
      }
      default:
        break;
    }
    for (const child of node.children ?? []) visit(child, linksRender);
  };
  visit(tree, true);
  if (!isMdx) facts.links = htmlLinks(tree as Root, content);
  return facts;
};

/** Parsing is the dominant cost; the dialog re-reads the same draft on every
 *  open and again right before publishing, so results are cached per content. */
const CACHE_LIMIT = 2000;
const factsCache = new Map<string, PageContentFacts>();

/** What a page's content renders that the checks look at (cached per content). */
export const pageContentFacts = (content: string): PageContentFacts => {
  const key = createHash('sha1').update(content).digest('base64');
  const cached = factsCache.get(key);
  if (cached) {
    factsCache.delete(key);
    factsCache.set(key, cached);
    return cached;
  }
  const facts = collectFacts(content);
  factsCache.set(key, facts);
  if (factsCache.size > CACHE_LIMIT) {
    const oldest = factsCache.keys().next().value;
    if (oldest !== undefined) factsCache.delete(oldest);
  }
  return facts;
};

/* ------------------------------------------------------------------------ */
/* Links, rendered and routed as the reader does                             */
/* ------------------------------------------------------------------------ */

const splitHref = (href: string): { pathname: string; query: string } => {
  const beforeHash = href.split('#')[0] ?? '';
  const queryAt = beforeHash.indexOf('?');
  return { pathname: queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash, query: queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '' };
};

/** The reader's `?lang=` search param: one non-empty value, else none (default language). */
const searchLanguage = (params: URLSearchParams): string | undefined => {
  const values = params.getAll('lang');
  return values.length === 1 && values[0] ? values[0] : undefined;
};

/** Resolve a pathname against base segments (`.` and `..` included), decoded
 *  and NFC-normalized like the reader's splat. */
const resolveSegments = (pathname: string, base: readonly string[]): string[] => {
  const parts = pathname.startsWith('/') ? [] : [...base];
  for (const raw of pathname.split('/')) {
    const segment = safeDecode(raw).normalize('NFC');
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts;
};

/** Follow what the reader serves for a site path, through configured and
 *  language-prefix redirects (bounded like redirect chains). */
const reaches = (snapshot: SiteSnapshot, startPath: string, startLang: string | undefined): boolean => {
  let path = startPath;
  let lang = startLang;
  for (let hop = 0; hop <= MAX_REDIRECT_CHAIN_LENGTH; hop++) {
    if (RESERVED_ROUTES.has(path)) return true;
    const route = resolveSiteRoute(snapshot, path, { lang });
    if (route.kind === 'page' || route.kind === 'openapi') return true;
    if (route.kind === 'not-found') return false;
    if (/^https?:\/\//i.test(route.to)) return true;
    const target = new URL(route.to, 'https://site.invalid');
    path = target.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => safeDecode(segment).normalize('NFC'))
      .join('/');
    lang = searchLanguage(target.searchParams);
  }
  return false;
};

/**
 * Whether a link on `page` reaches something on the published site, or null
 * for links this check does not judge (external, in-page anchors, files).
 *
 * Rendering follows the reader (`resolveDocHref`): a root-relative link gets
 * the page's version prefix (non-default versions) and, unless it names one,
 * the page's language (non-default languages); a relative link resolves
 * against the page URL and carries only its own `?lang=`.
 */
const createLinkResolver = (snapshot: SiteSnapshot) => {
  const defaultCode = publicLanguages(snapshot.project.languages).find((language) => language.isDefault)?.code;
  const versionById = new Map(snapshot.project.versions.map((version) => [version.id, version]));
  return (href: string, page: SnapshotPage): boolean | null => {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('{') || trimmed.startsWith('//') || SCHEME.test(trimmed)) return null;
    const { pathname, query } = splitHref(trimmed);
    if (!pathname) return null;
    const absolute = pathname.startsWith('/');
    const version = versionById.get(page.versionId);
    const versionPrefix = version && !version.isDefault ? [version.slug] : [];
    const base = absolute ? versionPrefix : [...versionPrefix, ...page.path.split('/').filter(Boolean).slice(0, -1)];
    const segments = resolveSegments(absolute ? pathname.slice(1) : pathname, base);
    const last = segments.at(-1) ?? '';
    if (PAGE_EXTENSION.test(last)) segments[segments.length - 1] = last.replace(PAGE_EXTENSION, '');
    else if (FILE_EXTENSION.test(last)) return null;

    const params = new URLSearchParams(query);
    const lang = params.has('lang') ? searchLanguage(params) : absolute && page.languageCode !== defaultCode ? page.languageCode : undefined;
    return reaches(snapshot, segments.join('/'), lang);
  };
};

interface BrokenInternalLink {
  page: SnapshotPage;
  /** The link as authored, e.g. `/configuration#options`. */
  href: string;
  /** Set when the link is broken because it is longer than the reader serves. */
  reason?: 'path-too-long';
}

/**
 * Every internal link that renders on a published page and leads nowhere on
 * the live site, once per page and href, in page order. Hidden pages and
 * disabled languages are not published, so their links are not checked (and
 * hidden pages are not link targets).
 */
export function findBrokenInternalLinks(snapshot: SiteSnapshot): BrokenInternalLink[] {
  const served = new Set(publicLanguages(snapshot.project.languages).map((language) => language.code));
  const resolveLink = createLinkResolver(snapshot);
  const broken: BrokenInternalLink[] = [];
  for (const page of snapshot.pages) {
    if (page.kind !== 'PAGE' || page.hidden || !served.has(page.languageCode)) continue;
    for (const href of new Set(pageContentFacts(page.content).links)) {
      // Over-long links are rejected before any resolution work (the reader 404s them).
      if (sitePathTooLong(href)) broken.push({ page, href, reason: 'path-too-long' });
      else if (resolveLink(href, page) === false) broken.push({ page, href });
    }
  }
  return broken;
}
