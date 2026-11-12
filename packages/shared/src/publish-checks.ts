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
 * - Links are read the way the reader renders the page: its own source
 *   normalization (`normalizeMdxBlocks`), then CommonMark + GFM, then raw HTML
 *   through parse5 (rehype-raw). A link counts only when it renders as one:
 *   code, comments, text that merely looks like a tag, and discarded HTML
 *   contexts render no link. Attribute destinations come from `<a>` and the
 *   components whose reader contract declares an `href`.
 *   Reference links resolve through their definition (CommonMark: the first
 *   definition of a label wins); a definition nothing uses renders nothing.
 * - A link is rendered as the reader renders it (relative to the page URL, or
 *   root-relative with the page's version prefix and language), then resolved
 *   with `resolveSiteRoute`, the reader's own route order, following redirects.
 */
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import type { Root } from 'mdast';
import { type DefaultTreeAdapterTypes, parseFragment } from 'parse5';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMdx from 'remark-mdx';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { documentationComponentContractEntries, documentationReaderTag } from './documentation-component-contract';
import { matchTags } from './markup-scan';
import { READER_EMBED_TAG } from './reader-embeds';
import { normalizeMdxBlocks } from './reader-markdown';
import { MAX_REDIRECT_CHAIN_LENGTH } from './redirects';
import { publicLanguages, type SiteSnapshot, type SnapshotPage } from './site';
import { resolveSiteRoute, sitePathTooLong } from './site-route';
import { isAllowedMediaUrl, isSiteMediaPath, videoEmbedFrom, videoPageUrl } from './video-embeds';

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
  data?: { hProperties?: Record<string, unknown> };
};

/** What one page renders that the checks look at. */
export interface PageContentFacts {
  /** Destinations of links that render, in document order. */
  links: string[];
  /** Sources of images that render without alt text. */
  imagesWithoutAlt: string[];
  /** Stray text left over from imports: a paragraph of only `/` or a literal `---`. */
  strayText: string[];
  /** Provider videos without a title (they get a generic accessible name), by their page address. */
  untitledEmbeds: string[];
  /** Iframes the reader shows as a link or as text instead of a player, by their address. */
  embedsAsLinks: string[];
  /** `<video>`/`<source>` addresses the reader won't play: not https and not on this site. */
  insecureVideos: string[];
  /** Iframes the reader doesn't show because no closer ends their block, by their address. */
  unclosedEmbeds: string[];
  /** Video posters the reader leaves out (anything but a file on this site), by their address. */
  hiddenPosters: string[];
}

type EmbedFacts = Pick<PageContentFacts, 'untitledEmbeds' | 'embedsAsLinks' | 'insecureVideos' | 'unclosedEmbeds' | 'hiddenPosters'>;

// The same parse as #426's link rewriter (micromark MDX + mdast-util-mdx, via
// remark-mdx). GFM is left out on purpose: it roughly doubles the cost and
// changes nothing the checks read (links in table cells parse the same, its
// autolink literals are external), except footnotes, handled below.
const mdxParser = unified().use(remarkParse).use(remarkMdx);
// The reader renders CommonMark (+ GFM): what it treats as code (indented code
// included, which MDX disables) comes from this parse, and invalid MDX is read
// with it entirely, where JSX and comments are raw HTML.
const markdownParser = unified().use(remarkParse);
// Invalid MDX is read for images and stray text as the reader reads it.
const htmlParser = unified().use(remarkParse).use(remarkGfm);
// Links use the reader's CommonMark -> HAST -> parse5 (rehype-raw) pipeline.
// GFM is left out for speed: of what it adds, only footnotes render links, and
// those are in-page (their labels are filtered below); table cells, task lists
// and strikethrough parse links the same, and its autolink literals are external.
const readerLinkParser = unified().use(remarkParse).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw);
/** Without GFM a footnote (`[^1]` with `[^1]: text`) parses as a reference
 *  link; the reader renders it as an in-page footnote, never a page link. */
const isFootnoteLabel = (identifier: string | undefined): boolean => identifier?.startsWith('^') === true;

/** Excluded from the MDX walk (images and stray text); links are collected separately. */
const SILENT = new Set(['code', 'inlineCode', 'html', 'mdxFlowExpression', 'mdxTextExpression', 'mdxjsEsm', 'yaml', 'toml']);
// The reader's plain <a>, plus every component whose reader contract declares
// an `href` (the same contract mdx-config's sanitizer and component map use),
// by the lowercase tag name the HTML parser gives it.
const LINK_ELEMENTS = new Set([
  'a',
  ...documentationComponentContractEntries().flatMap(([tag, component]) => ('href' in component.attributes ? [documentationReaderTag(tag)] : [])),
]);
/** Elements the embed checks read (see `collectEmbed`). */
const EMBED_ELEMENTS = new Set([READER_EMBED_TAG, 'video', 'source']);
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
 * Keep the source HTML context even if rehype-raw reparents generated nodes.
 * Only the raw HTML nodes CommonMark found are parsed (everything else is
 * blanked), so Markdown text that looks like a tag (`\<script>`) opens no context. */
const htmlNonLinkRanges = (tree: Root, content: string): { start: number; end: number }[] => {
  // UTF-16 units, matching the offsets of both parsers.
  const masked: string[] = content.split('').map((char) => (char === '\n' ? char : ' '));
  const keepHtml = (node: MarkdownNode) => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (node.type === 'html' && start !== undefined && end !== undefined) {
      for (let index = start; index < end; index++) masked[index] = content[index] ?? ' ';
    } else for (const child of node.children ?? []) keepHtml(child);
  };
  keepHtml(tree);
  const ranges: { start: number; end: number }[] = [];
  const visit = (node: DefaultTreeAdapterTypes.ChildNode) => {
    if ('tagName' in node && NON_LINK_CONTEXTS.has(node.tagName) && node.sourceCodeLocation) {
      // An unclosed context runs to the end of the page.
      ranges.push({ start: node.sourceCodeLocation.startOffset, end: node.sourceCodeLocation.endOffset ?? content.length });
      return;
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
  };
  for (const child of parseFragment(masked.join(''), { sourceCodeLocationInfo: true }).childNodes) visit(child);
  return ranges;
};

/**
 * Whether an offset lies inside any of the ranges, answered in O(log n) per
 * offset: the ranges are sorted once by start, with the largest end seen so
 * far, so a page with many contexts and many links or embeds stays linear.
 * Same answer as checking every range (an unclosed context can overlap later ones).
 */
export const offsetInRanges = (ranges: { start: number; end: number }[]): ((offset: number) => boolean) => {
  if (ranges.length === 0) return () => false;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const starts = sorted.map((range) => range.start);
  const maxEnds: number[] = [];
  for (const range of sorted) maxEnds.push(Math.max(range.end, maxEnds.at(-1) ?? range.end));
  return (offset) => {
    // The last range starting at or before the offset.
    let low = 0;
    let high = starts.length - 1;
    let last = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((starts[middle] as number) <= offset) {
        last = middle;
        low = middle + 1;
      } else high = middle - 1;
    }
    return last >= 0 && (maxEnds[last] as number) > offset;
  };
};

/** A raw HTML node that may open one of the NON_LINK_CONTEXTS (it can span later nodes). */
const NON_LINK_TAG = new RegExp(`<(?:${[...NON_LINK_CONTEXTS].join('|')})(?![a-z0-9-])`, 'i');

/** HAST property holding a Markdown link's destination as authored. */
const AUTHORED_HREF = 'dataAuthoredHref';

const propertyText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** What one element contributes to the embed checks, read as the reader's renderer reads it. */
const collectEmbed = (node: HtmlNode, parent: HtmlNode | undefined, embeds: EmbedFacts): void => {
  const properties = node.properties ?? {};
  if (node.tagName === READER_EMBED_TAG) {
    const video = videoEmbedFrom(properties.provider, properties.videoid, properties.start);
    if (video) {
      if (!propertyText(properties.title)) embeds.untitledEmbeds.push(videoPageUrl(video));
    } else {
      const address = propertyText(properties.href) || propertyText(properties.text);
      if (address) embeds.embedsAsLinks.push(address);
    }
  } else if (node.tagName === 'video' || (node.tagName === 'source' && parent?.tagName === 'video')) {
    const src = propertyText(properties.src);
    if (src && !isAllowedMediaUrl(src)) embeds.insecureVideos.push(src);
    const poster = node.tagName === 'video' ? propertyText(properties.poster) : '';
    if (poster && !isSiteMediaPath(poster)) embeds.hiddenPosters.push(poster);
  }
};

/** Link destinations after HTML parsing, never text that merely looks like a tag;
 *  embeds (iframes as the reader rewrites them, and videos) from the same tree. */
const htmlLinks = (tree: Root, content: string, embeds: EmbedFacts): string[] => {
  const links: string[] = [];
  // CommonMark: the first definition of a label wins.
  const definitions = new Map<string, string>();
  let hasHtml = false;
  let hasNonLinkContext = false;
  const survey = (node: MarkdownNode) => {
    if (
      node.type === 'definition' &&
      node.identifier &&
      !isFootnoteLabel(node.identifier) &&
      node.url !== undefined &&
      !definitions.has(node.identifier)
    ) {
      definitions.set(node.identifier, node.url);
    }
    if (node.type === 'html') {
      hasHtml = true;
      if (NON_LINK_TAG.test(node.value ?? '')) hasNonLinkContext = true;
    }
    for (const child of node.children ?? []) survey(child);
  };
  survey(tree as MarkdownNode);
  // Without raw HTML, the rendered links are exactly the Markdown links
  // (a reference renders as a link only when its label is defined).
  if (!hasHtml) {
    const markdownLinks = (node: MarkdownNode) => {
      const url = node.type === 'link' ? node.url : node.type === 'linkReference' && node.identifier ? definitions.get(node.identifier) : undefined;
      if (url) links.push(url);
      for (const child of node.children ?? []) markdownLinks(child);
    };
    markdownLinks(tree as MarkdownNode);
    return links;
  }
  const suppressed = offsetInRanges(hasNonLinkContext ? htmlNonLinkRanges(tree, content) : []);
  // HAST percent-encodes Markdown destinations (`/دليل` → `/%D8%AF…`). Carry the
  // authored one through, so the checks report what the author wrote.
  const markAuthored = (node: MarkdownNode) => {
    // A footnote reference is in-page: marked empty, so it is never checked.
    const authored =
      node.type === 'link'
        ? node.url
        : node.type === 'linkReference' && node.identifier
          ? isFootnoteLabel(node.identifier)
            ? ''
            : definitions.get(node.identifier)
          : undefined;
    if (authored !== undefined) node.data = { ...node.data, hProperties: { ...node.data?.hProperties, [AUTHORED_HREF]: authored } };
    for (const child of node.children ?? []) markAuthored(child);
  };
  markAuthored(tree as MarkdownNode);
  const visit = (node: HtmlNode, parent?: HtmlNode) => {
    // Every complete iframe became the reader's embed element (./reader-embeds), so one
    // still here has no closer in its block (or a tag the rewrite couldn't read).
    if (node.tagName === 'iframe') embeds.unclosedEmbeds.push(propertyText(node.properties?.src) || '<iframe>');
    if (node.tagName && NON_LINK_CONTEXTS.has(node.tagName)) return;
    if (node.tagName && (LINK_ELEMENTS.has(node.tagName) || EMBED_ELEMENTS.has(node.tagName))) {
      const offset = node.position?.start.offset;
      if (offset !== undefined && suppressed(offset)) return;
      collectEmbed(node, parent, embeds);
    }
    if (node.tagName && LINK_ELEMENTS.has(node.tagName)) {
      // An element exists here only when the reader parses it as HTML. A JSX
      // spread on its own line is text to CommonMark and never gets this far;
      // inside a raw HTML block it is an unknown attribute the sanitizer drops,
      // and the element still renders its href.
      const href = node.properties?.[AUTHORED_HREF] ?? node.properties?.href;
      if (typeof href === 'string' && href && !href.trimStart().startsWith('{')) links.push(href);
    }
    for (const child of node.children ?? []) visit(child, node);
  };
  visit(readerLinkParser.runSync(tree));
  return links;
};

/** Raw `<img>` tags (as rehype-raw renders them) without a usable alt. */
const htmlImagesWithoutAlt = (html: string): string[] =>
  // matchTags: the same tags as matchAll, read in linear time when a `>` is missing.
  matchTags(html, HTML_IMAGE).flatMap(([tag]) => {
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

  const facts: PageContentFacts = {
    links: [],
    imagesWithoutAlt: [],
    strayText: [],
    untitledEmbeds: [],
    embedsAsLinks: [],
    insecureVideos: [],
    unclosedEmbeds: [],
    hiddenPosters: [],
  };
  const visit = (node: MarkdownNode) => {
    if (inCode(node) || NON_LINK_CONTEXTS.has(node.name?.toLowerCase() ?? '')) return;
    if (SILENT.has(node.type)) {
      if (node.type === 'html' && !node.value?.trimStart().startsWith('<!--')) {
        facts.imagesWithoutAlt.push(...htmlImagesWithoutAlt(node.value ?? ''));
        for (const [, text] of (node.value ?? '').matchAll(HTML_STRAY_PARAGRAPH)) if (text) facts.strayText.push(text.startsWith('-') ? '---' : '/');
      }
      return;
    }
    switch (node.type) {
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
        if (node.name === 'img') {
          const alt = jsxAttribute(node, 'alt');
          // `alt={expression}` is authored on purpose; only a missing or blank alt is flagged.
          const altText = typeof alt?.value === 'string' ? alt.value : alt?.value ? 'expression' : '';
          if (!altText.trim()) {
            const src = jsxAttribute(node, 'src')?.value;
            facts.imagesWithoutAlt.push(typeof src === 'string' ? src : '');
          }
        }
        for (const child of node.children ?? []) visit(child);
        return;
      }
      default:
        break;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  // Links as the reader renders them: its normalized source, through its pipeline.
  const readerSource = normalizeMdxBlocks(content);
  facts.links = htmlLinks(readerLinkParser.parse(readerSource) as Root, readerSource, facts);
  return facts;
};

/** Parsing is the dominant cost; the dialog re-reads the same draft on every
 *  open and again right before publishing, so results are cached per content. */
const CACHE_LIMIT = 2000;
const factsCache = new Map<string, PageContentFacts>();

/** What a page's content renders that the checks look at (cached per content). */
export const pageContentFacts = (content: string, cache = true): PageContentFacts => {
  const key = createHash('sha1').update(content).digest('base64');
  const cached = factsCache.get(key);
  if (cached) {
    factsCache.delete(key);
    factsCache.set(key, cached);
    return cached;
  }
  const facts = collectFacts(content);
  if (!cache) return facts;
  factsCache.set(key, facts);
  if (factsCache.size > CACHE_LIMIT) {
    const oldest = factsCache.keys().next().value;
    if (oldest !== undefined) factsCache.delete(oldest);
  }
  return facts;
};

/** Facts per snapshot, by content. A site with more pages than the shared cache
 *  holds would evict it in order on every scan, so a second pass (publish checks
 *  read each page twice) or a repeat open re-parsed every page. Keyed by the
 *  snapshot's pages array, like the page index in site-route, so the facts live
 *  as long as the snapshot; the shared cache still carries facts across
 *  snapshots of sites that fit in it. */
const snapshotFacts = new WeakMap<readonly SnapshotPage[], Map<string, PageContentFacts>>();

/** `pageContentFacts` for one snapshot's pages, parsed at most once per content. */
export const snapshotContentFacts = (snapshot: SiteSnapshot): ((content: string) => PageContentFacts) => {
  const memo = snapshotFacts.get(snapshot.pages) ?? new Map<string, PageContentFacts>();
  snapshotFacts.set(snapshot.pages, memo);
  // A scan larger than the shared cache reuses its entries but adds none.
  const shared = snapshot.pages.length <= CACHE_LIMIT;
  return (content) => {
    let facts = memo.get(content);
    if (!facts) {
      facts = pageContentFacts(content, shared);
      memo.set(content, facts);
    }
    return facts;
  };
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
const reaches = (snapshot: SiteSnapshot, startPath: string, startLang: string | undefined): boolean | SnapshotPage => {
  let path = startPath;
  let lang = startLang;
  for (let hop = 0; hop <= MAX_REDIRECT_CHAIN_LENGTH; hop++) {
    if (RESERVED_ROUTES.has(path)) return true;
    const route = resolveSiteRoute(snapshot, path, { lang });
    if (route.kind === 'page') return route.page;
    if (route.kind === 'openapi') return true;
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
  // A site's shared navigation links repeat across many bodies. Normalize in
  // the source page's context first, then resolve each destination only once
  // per immutable snapshot scan (including redirect chains).
  const destinations = new Map<string, ReturnType<typeof reaches>>();
  return (href: string, page: SnapshotPage, siteAbsolute = false): boolean | SnapshotPage | null => {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('{') || trimmed.startsWith('//') || SCHEME.test(trimmed)) return null;
    const { pathname, query } = splitHref(trimmed);
    if (!pathname) return null;
    const absolute = pathname.startsWith('/');
    const version = versionById.get(page.versionId);
    const versionPrefix = !siteAbsolute && version && !version.isDefault ? [version.slug] : [];
    const base = absolute ? versionPrefix : [...versionPrefix, ...page.path.split('/').filter(Boolean).slice(0, -1)];
    const segments = resolveSegments(absolute ? pathname.slice(1) : pathname, base);
    const last = segments.at(-1) ?? '';
    if (PAGE_EXTENSION.test(last)) segments[segments.length - 1] = last.replace(PAGE_EXTENSION, '');
    else if (FILE_EXTENSION.test(last)) return null;

    const params = new URLSearchParams(query);
    const lang = params.has('lang')
      ? searchLanguage(params)
      : !siteAbsolute && absolute && page.languageCode !== defaultCode
        ? page.languageCode
        : undefined;
    const path = segments.join('/');
    const key = JSON.stringify([path, lang]);
    const cached = destinations.get(key);
    if (cached !== undefined) return cached;
    const destination = reaches(snapshot, path, lang);
    destinations.set(key, destination);
    return destination;
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
  const factsOf = snapshotContentFacts(snapshot);
  const broken: BrokenInternalLink[] = [];
  for (const page of snapshot.pages) {
    if (page.kind !== 'PAGE' || page.hidden || !served.has(page.languageCode)) continue;
    for (const href of new Set(factsOf(page.content).links)) {
      // Over-long links are rejected before any resolution work (the reader 404s them).
      if (sitePathTooLong(href)) broken.push({ page, href, reason: 'path-too-long' });
      else if (resolveLink(href, page) === false) broken.push({ page, href });
    }
  }
  return broken;
}

/** Draft pages outside a deleted subtree that render a link into it. Sources
 * stay on the target's branch; destinations follow the reader's version,
 * language, fallback and redirect rules. Hidden drafts are sources too.
 * Parsing uses the same per-content cache as publish checks. */
export interface InboundPageLinks {
  pages: Pick<SnapshotPage, 'id' | 'title' | 'path'>[];
  total: number;
}

/** Only the inbound advisory treats absolute URLs on trusted site hosts as
 * internal. Publish checks deliberately continue treating them as external.
 * URL normalizes host case and each scheme's default port. */
const stripSiteOrigin = (href: string, hosts: ReadonlySet<string>): string | null => {
  const trimmed = href.trim();
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith('//')) return null;
  try {
    const url = new URL(trimmed, 'https://site.invalid');
    if (!hosts.has(url.host)) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
};

/** Compute every deletion advisory in one scan. Keep only capped summaries
 * and counts, so the server can cache the branch map without retaining bodies
 * or unbounded inbound edge lists. */
function* inboundPageLinkSteps(snapshot: SiteSnapshot, trustedOrigins: readonly string[]): Generator<void, Map<string, InboundPageLinks>> {
  const hosts = new Set(trustedOrigins.map((origin) => new URL(origin).host));
  const byId = new Map<string, SnapshotPage>();
  const results = new Map<string, InboundPageLinks>();
  for (const page of snapshot.pages) {
    byId.set(page.id, page);
    results.set(page.id, { pages: [], total: 0 });
    yield;
  }
  const resolveLink = createLinkResolver(snapshot);
  const factsOf = snapshotContentFacts(snapshot);
  for (const page of snapshot.pages) {
    if (page.kind !== 'PAGE') continue;
    const ancestors = new Set<string>();
    for (let id: string | undefined = page.id; id && !ancestors.has(id); id = byId.get(id)?.parentId ?? undefined) ancestors.add(id);
    const affected = new Set<string>();
    for (const href of factsOf(page.content).links) {
      if (sitePathTooLong(href)) continue;
      const siteHref = stripSiteOrigin(href, hosts);
      // Full URLs already select their version/language. Unlike root-relative
      // authored links, the reader does not add the source page's context.
      const destination = resolveLink(siteHref ?? href, page, siteHref !== null);
      if (typeof destination !== 'object' || destination === null || destination.versionId !== page.versionId) continue;
      // A source inside an ancestor's subtree goes to Trash with it. Shared
      // ancestors of multiple destinations count only once for this source.
      for (let id: string | undefined = destination.id; id && !ancestors.has(id) && !affected.has(id); id = byId.get(id)?.parentId ?? undefined)
        affected.add(id);
    }
    const summary = { id: page.id, title: page.title, path: page.path };
    for (const id of affected) {
      const result = results.get(id);
      if (!result) continue;
      result.total += 1;
      if (result.pages.length < 20) result.pages.push(summary);
    }
    yield;
  }
  return results;
}

export function buildInboundPageLinkMap(snapshot: SiteSnapshot, trustedOrigins: readonly string[] = []): Map<string, InboundPageLinks> {
  const steps = inboundPageLinkSteps(snapshot, trustedOrigins);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Same ordered scan as the synchronous advisory, with an elapsed-time budget.
 * A page's parse is indivisible; check after each page rather than guessing how
 * many pages fit a slice. Clock/scheduler injection keeps slice tests untimed. */
export async function buildInboundPageLinkMapAsync(
  snapshot: SiteSnapshot,
  trustedOrigins: readonly string[] = [],
  {
    signal,
    sliceMs = 25,
    now = () => performance.now(),
    yieldToEventLoop = setImmediate,
  }: {
    signal?: AbortSignal;
    sliceMs?: number;
    now?: () => number;
    yieldToEventLoop?: () => Promise<unknown>;
  } = {},
): Promise<Map<string, InboundPageLinks>> {
  signal?.throwIfAborted();
  const steps = inboundPageLinkSteps(snapshot, trustedOrigins);
  let started = now();
  let step = steps.next();
  while (!step.done) {
    if (now() - started >= sliceMs) {
      await yieldToEventLoop();
      signal?.throwIfAborted();
      started = now();
    }
    step = steps.next();
  }
  signal?.throwIfAborted();
  return step.value;
}

export function findInboundPageLinks(snapshot: SiteSnapshot, pageId: string, trustedOrigins: readonly string[] = []): InboundPageLinks {
  return buildInboundPageLinkMap(snapshot, trustedOrigins).get(pageId) ?? { pages: [], total: 0 };
}
