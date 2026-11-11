import { fencedMarkdownLines } from './markdown-code';
import { normalizeRedirectPath } from './redirects';
import { buildNavTree, type NavNode, publicLanguages, type SiteSnapshot, type SnapshotPage } from './site';

/**
 * One definition of a broken internal link, shared by the publish dialog's
 * preflight (apps/server) and the publish worker's gate (apps/worker), so the
 * dialog never calls a publish "allowed" that the worker then rejects.
 *
 * Pure and query-free: indexes are built once per snapshot, then every page is
 * scanned in a single pass.
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** Routes the reader serves without a page: the changelog and generated files. */
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

/** Whether publishing enforces the broken-link check: the CI-checks umbrella
 *  and the broken-links add-on are both on (each defaults to on). */
export const brokenLinkCheckEnabled = (projectConfig: unknown): boolean => {
  const addons = objectValue(objectValue(projectConfig).addons);
  return addons.ciChecks !== false && addons.brokenLinks !== false;
};

/** The page's prose with code removed, line for line: fenced blocks become
 *  empty lines and inline code spans / `<pre>` / `<code>` become spaces, so
 *  line positions (and so paragraph boundaries) survive. */
export const markdownProseLines = (content: string): string[] => {
  const withoutHtmlCode = content.replace(/<(pre|code)\b[\s\S]*?<\/\1>/gi, (block) => block.replace(/[^\n]/g, ' '));
  const lines = withoutHtmlCode.split('\n');
  const fenced = fencedMarkdownLines(lines);
  return lines.map((line, index) => (fenced[index] ? '' : line.replace(/(`+)[^`]*?\1/g, (span) => ' '.repeat(span.length))));
};

/** Inline `[text](href "title")` links (one level of nested brackets, so a
 *  linked image counts), reference definitions and `href="…"` attributes. */
const INLINE_LINK = /(?<![!\\])\[(?:[^[\]]|\[[^[\]]*\])*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*\)/g;
/** `[label]: /target`, but not a footnote (`[^1]: text`). */
const REFERENCE_DEFINITION = /^ {0,3}\[(?!\^)[^\]]+\]:\s*(<[^>]*>|\S+)/;
const HREF_ATTRIBUTE = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;

const linksIn = (lines: readonly string[]): string[] => {
  const links: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(INLINE_LINK)) {
      if (match[1]) links.push(match[1].replace(/^<|>$/g, ''));
    }
    const definition = REFERENCE_DEFINITION.exec(line);
    if (definition?.[1]) links.push(definition[1].replace(/^<|>$/g, ''));
    for (const match of line.matchAll(HREF_ATTRIBUTE)) {
      const href = match[1] ?? match[2];
      if (href) links.push(href);
    }
  }
  return links;
};

const flattenPages = (nodes: readonly NavNode[]): NavNode[] =>
  nodes.flatMap((node) => (node.kind === 'PAGE' ? [node, ...flattenPages(node.children)] : flattenPages(node.children)));

const prefixesOf = (path: string): string[] => {
  const parts = path.split('/').filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
};

/** The routes one language of one docs version serves: exact page paths, the
 *  group prefixes the reader forwards to their first page, and whether the
 *  site root has a page to land on. */
interface RouteIndex {
  pages: Set<string>;
  prefixes: Set<string>;
  hasRoot: boolean;
}

const routeIndexes = (snapshot: SiteSnapshot, languageCodes: readonly string[]): Map<string, RouteIndex> => {
  const byVersion = new Map<string, SnapshotPage[]>();
  for (const page of snapshot.pages) {
    const list = byVersion.get(page.versionId) ?? [];
    list.push(page);
    byVersion.set(page.versionId, list);
  }
  const indexes = new Map<string, RouteIndex>();
  for (const [versionId, pages] of byVersion) {
    for (const code of languageCodes) {
      const ordered = flattenPages(buildNavTree(pages, code));
      const index: RouteIndex = { pages: new Set(), prefixes: new Set(), hasRoot: ordered.length > 0 };
      for (const page of pages) {
        if (page.languageCode === code && page.kind === 'PAGE' && !page.hidden) index.pages.add(page.path.normalize('NFC'));
      }
      for (const node of ordered) {
        for (const prefix of prefixesOf(node.path.normalize('NFC'))) index.prefixes.add(prefix);
      }
      indexes.set(`${versionId}:${code}`, index);
    }
  }
  return indexes;
};

const splitHref = (href: string): { pathname: string; query: string } => {
  const beforeHash = href.split('#')[0] ?? '';
  const queryAt = beforeHash.indexOf('?');
  return { pathname: queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash, query: queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '' };
};

/** Resolve a pathname against the page's directory (`..` and `.` included),
 *  decoded and NFC-normalized like the reader's splat. */
const resolveSegments = (pathname: string, currentPath: string): string[] => {
  const parts = pathname.startsWith('/') ? [] : currentPath.split('/').filter(Boolean).slice(0, -1);
  for (const raw of pathname.split('/')) {
    const segment = safeDecode(raw).normalize('NFC');
    if (!segment || segment === '.') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts;
};

const normalizePath = (path: string): string =>
  path
    .split('/')
    .filter(Boolean)
    .map((segment) => safeDecode(segment).normalize('NFC'))
    .join('/');

const baseCode = (code: string): string => code.split('-')[0] ?? code;

/**
 * Whether a link in `page` reaches a page on the published site. Mirrors the
 * reader: root-relative links stay in the page's language and docs version
 * (`?lang=` switches language, a non-default version's slug switches version),
 * a missing translation falls back to the default language, the API reference
 * and reserved routes exist, configured redirects claim a path before a 404,
 * and a `/ar/…` style language prefix forwards to that language.
 * Returns null for links this check does not judge (external, anchors, files).
 */
const createLinkResolver = (snapshot: SiteSnapshot) => {
  const languages = publicLanguages(snapshot.project.languages);
  const codes = languages.map((language) => language.code);
  const defaultCode = languages.find((language) => language.isDefault)?.code ?? codes[0] ?? '';
  const versions = snapshot.project.versions;
  const versionById = new Map(versions.map((version) => [version.id, version]));
  const indexes = routeIndexes(snapshot, codes);
  const openApiPath = snapshot.openapi ? normalizePath(snapshot.openapi.path) : null;
  const rawRedirects = objectValue(snapshot.project.config).redirects;
  const redirectSources = new Set<string>();
  for (const redirect of Array.isArray(rawRedirects) ? rawRedirects : []) {
    const from = objectValue(redirect).from;
    if (typeof from !== 'string') continue;
    try {
      redirectSources.add(normalizeRedirectPath(from).normalize('NFC'));
    } catch {
      // A malformed redirect is reported (and blocks) through redirect validation.
    }
  }

  const servedIn = (versionId: string, language: string, path: string): boolean => {
    const active = codes.includes(language) ? language : defaultCode;
    const found = (code: string) => {
      const index = indexes.get(`${versionId}:${code}`);
      return Boolean(index && (path === '' ? index.hasRoot : index.pages.has(path) || index.prefixes.has(path)));
    };
    return found(active) || (active !== defaultCode && found(defaultCode));
  };

  return (href: string, page: SnapshotPage): boolean | null => {
    const trimmed = href.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('{') || trimmed.startsWith('//') || SCHEME.test(trimmed)) return null;
    const { pathname, query } = splitHref(trimmed);
    if (!pathname) return null;
    const segments = resolveSegments(pathname, page.path);
    const last = segments.at(-1) ?? '';
    if (PAGE_EXTENSION.test(last)) segments[segments.length - 1] = last.replace(PAGE_EXTENSION, '');
    else if (FILE_EXTENSION.test(last)) return null;

    // One `lang` switches language; none keeps the page's; several are
    // ambiguous, so the reader serves its default language.
    const requestedLanguages = new URLSearchParams(query).getAll('lang');
    const language = requestedLanguages.length === 0 ? page.languageCode : requestedLanguages.length === 1 ? (requestedLanguages[0] ?? '') : '';
    const pageVersion = versionById.get(page.versionId);
    // A non-default version's page links inside its version (the reader adds
    // its slug); a default-version page reaches another version by its slug.
    const routePrefix = pageVersion && !pageVersion.isDefault ? [pageVersion.slug] : [];
    const routePath = [...routePrefix, ...segments].join('/');
    let versionId = page.versionId;
    let contentSegments = segments;
    const explicit = versions.find((version) => !version.isDefault && version.slug === segments[0]);
    if (routePrefix.length === 0 && explicit) {
      versionId = explicit.id;
      contentSegments = segments.slice(1);
    }

    if (servedIn(versionId, language, contentSegments.join('/'))) return true;
    if (openApiPath !== null && routePath === openApiPath) return true;
    if (RESERVED_ROUTES.has(routePath)) return true;
    if (redirectSources.has(routePath)) return true;
    const prefixed = contentSegments[0]?.toLowerCase();
    const prefixLanguage =
      prefixed &&
      (languages.find((item) => item.code.toLowerCase() === prefixed) ?? languages.find((item) => baseCode(item.code).toLowerCase() === prefixed));
    if (prefixLanguage) {
      const rest = contentSegments.slice(1).join('/');
      return servedIn(versionId, prefixLanguage.code, rest) || redirectSources.has([...routePrefix, rest].filter(Boolean).join('/'));
    }
    return false;
  };
};

interface BrokenInternalLink {
  page: SnapshotPage;
  /** The link as authored, e.g. `/configuration#options`. */
  href: string;
}

/**
 * Every internal link on a published page that leads nowhere on the live site,
 * once per page and href, in page order. Hidden pages and disabled languages
 * are not published, so their links are not checked (and hidden pages are not
 * link targets). Links inside code are ignored.
 */
export function findBrokenInternalLinks(snapshot: SiteSnapshot): BrokenInternalLink[] {
  const served = new Set(publicLanguages(snapshot.project.languages).map((language) => language.code));
  const resolveLink = createLinkResolver(snapshot);
  const broken: BrokenInternalLink[] = [];
  for (const page of snapshot.pages) {
    if (page.kind !== 'PAGE' || page.hidden || !served.has(page.languageCode)) continue;
    for (const href of new Set(linksIn(markdownProseLines(page.content)))) {
      if (resolveLink(href, page) === false) broken.push({ page, href });
    }
  }
  return broken;
}
