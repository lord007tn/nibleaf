import { INTERFACE_LOCALES } from '@nibleaf/i18n/locales';
import { editor_newgroup, editor_untitled } from '@nibleaf/i18n/messages';
import { fencedMarkdownLines } from '@nibleaf/shared/markdown-code';
import { normalizeRedirectPath } from '@nibleaf/shared/redirects';
import { buildNavTree, type NavNode, publicLanguages, type SiteSnapshot, type SnapshotPage } from '@nibleaf/shared/site';

/**
 * Pre-publish quality checks, computed from the exact draft snapshot the
 * publish dialog previews. Everything is a warning that leaves publishing
 * allowed, except a broken internal link while the site's broken-link check is
 * on: the publish worker rejects those, so the dialog blocks them up front.
 *
 * One pass over the snapshot's pages with in-memory indexes: no queries, so a
 * 300-page site costs a few milliseconds.
 */
type PublishCheckCode =
  | 'broken-internal-link'
  | 'missing-alt'
  | 'untitled-page'
  | 'stray-characters'
  | 'unreadable-slug'
  | 'empty-page'
  | 'duplicate-title';

export interface PublishCheck {
  code: PublishCheckCode;
  severity: 'error' | 'warning';
  pageId: string;
  languageCode: string;
  title: string;
  path: string;
  /** The evidence: the link, the image source, the stray text, the slug or the
   *  path of the other page with the same title. Empty for an untitled or
   *  empty page, where the page itself is the evidence. */
  detail: string;
}

/** A huge site with a systematic problem (every image without alt text) must
 *  not ship a multi-MB preflight. Errors sort first, so they are never cut. */
const MAX_CHECKS = 500;
const MAX_PER_PAGE_AND_CODE = 10;
const MAX_READABLE_SLUG_LENGTH = 80;

/** The placeholder titles the dashboard gives a new page or group, in every
 *  interface locale ("Untitled", "صفحة بدون عنوان", "New group", …). */
const PLACEHOLDER_TITLES = new Set<string>(
  INTERFACE_LOCALES.flatMap(({ code }) => [editor_untitled(undefined, { locale: code }), editor_newgroup(undefined, { locale: code })]).map((title) =>
    title.trim().normalize('NFC'),
  ),
);
const PLACEHOLDER_SLUG = /^(?:untitled|new-group)(?:-\d+)?$/;
/** Slugs that are an id rather than words: cuid/uuid/hex/nanoid shapes and the
 *  importers' `group-9e4c82a8` fallbacks. ASCII only, so Arabic never matches. */
const ID_LIKE_SLUGS = [
  /^c[a-z0-9]{20,}$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{12,}$/i,
  /^\d{6,}$/,
  /^(?:page|group|section|doc|untitled|new-group)[-_]?[0-9a-f]{6,}$/i,
];
/** A nanoid-style token: one long run of mixed-case letters and digits. A
 *  long lowercase word with a digit (`ipv6configuration`) is still a word. */
const isRandomToken = (slug: string): boolean => /^[A-Za-z0-9_]{16,}$/.test(slug) && /\d/.test(slug) && /[a-z]/.test(slug) && /[A-Z]/.test(slug);

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const RESERVED_ROUTES = new Set(['changelog', 'sitemap.xml', 'robots.txt', 'llms.txt', 'llms-full.txt']);

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const normalizeTitle = (title: string): string => title.trim().normalize('NFC');

const isPlaceholderTitle = (title: string): boolean => {
  const normalized = normalizeTitle(title);
  return !normalized || PLACEHOLDER_TITLES.has(normalized);
};

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127);

/** A slug readers can't read: empty, too long, percent-encoded or broken
 *  bytes, or generated (a placeholder or an id). Arabic and other non-Latin
 *  words read fine. */
const isUnreadableSlug = (slug: string): boolean => {
  const value = slug.trim();
  return (
    !value ||
    /%[0-9a-f]{2}/i.test(value) ||
    value.includes(String.fromCharCode(0xff_fd)) ||
    hasControlCharacter(value) ||
    [...value].length > MAX_READABLE_SLUG_LENGTH ||
    PLACEHOLDER_SLUG.test(value) ||
    ID_LIKE_SLUGS.some((pattern) => pattern.test(value)) ||
    isRandomToken(value)
  );
};

/** The page's prose with code removed, line for line: fenced blocks become
 *  empty lines and inline code spans / `<pre>` / `<code>` become spaces, so
 *  line positions (and so paragraph boundaries) survive. */
const proseLines = (content: string): string[] => {
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

const MARKDOWN_IMAGE = /!\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*(<[^>]*>|[^)\s]+)/g;
const HTML_IMAGE = /<img\b[^>]*>/gi;

/** The sources of images that have no alt text. */
const imagesWithoutAlt = (lines: readonly string[]): string[] => {
  const sources: string[] = [];
  for (const line of lines) {
    for (const match of line.matchAll(MARKDOWN_IMAGE)) {
      if (!match[1]?.replace(/\\/g, '').trim()) sources.push((match[2] ?? '').replace(/^<|>$/g, ''));
    }
    for (const match of line.matchAll(HTML_IMAGE)) {
      const tag = match[0];
      // `alt={expression}` is authored on purpose; only a missing or blank one is flagged.
      const alt = /\balt\s*=\s*(?:"([^"]*)"|'([^']*)'|(\{))/i.exec(tag);
      if (!alt || (!alt[3] && !(alt[1] ?? alt[2] ?? '').trim())) {
        sources.push(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)?.slice(1).find(Boolean) ?? '');
      }
    }
  }
  return sources;
};

/** Leftovers from imports and the slash menu: a paragraph that is only `/`,
 *  or a `---` that was stored as literal text (escaped, or inside `<p>`)
 *  instead of becoming a divider. */
const strayParagraphs = (lines: readonly string[]): string[] => {
  const stray: string[] = [];
  const blank = (index: number) => index < 0 || index >= lines.length || !lines[index]?.trim();
  lines.forEach((line, index) => {
    const text = line.trim();
    const paragraph = /^<p>\s*([\s\S]*?)\s*<\/p>$/i.exec(text)?.[1]?.trim();
    const ownParagraph = blank(index - 1) && blank(index + 1);
    if ((text === '/' && ownParagraph) || paragraph === '/') {
      stray.push('/');
    } else if ((text.includes('\\') && /^-{3,}$/.test(text.replace(/\\/g, ''))) || (paragraph !== undefined && /^-{3,}$/.test(paragraph))) {
      stray.push('---');
    }
  });
  return stray;
};

/** Body text once comments and whitespace are gone; empty means no body. */
const hasBody = (content: string): boolean =>
  content
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .trim().length > 0;

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

/** Resolve `segments` against the page's directory (`..` and `.` included),
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

const baseCode = (code: string): string => code.split('-')[0] ?? code;

/**
 * Whether a link in `page` reaches a page on the published site. Mirrors the
 * reader: root-relative links stay in the page's language and docs version
 * (`?lang=` switches language, a non-default version's slug switches version),
 * a missing translation falls back to the default language, the API reference
 * and reserved files are real routes, configured redirects claim a path before
 * a 404, and a `/ar/…` style language prefix forwards to that language.
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
  const rawRedirects = (snapshot.project.config as { redirects?: unknown } | null)?.redirects;
  const redirectSources = new Set<string>();
  for (const redirect of Array.isArray(rawRedirects) ? rawRedirects : []) {
    const from = (redirect as { from?: unknown } | null)?.from;
    if (typeof from !== 'string') continue;
    try {
      redirectSources.add(normalizeRedirectPath(from).normalize('NFC'));
    } catch {
      // A malformed redirect is reported (and blocks) through redirectIssues.
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
    // Files (images, PDFs, sitemap.xml) are not pages; `.md`/`.mdx` copies are.
    if (/\.(mdx?)$/i.test(last)) segments[segments.length - 1] = last.replace(/\.(mdx?)$/i, '');
    else if (/\.[a-z0-9]{2,8}$/i.test(last)) return null;

    const requestedLanguages = new URLSearchParams(query).getAll('lang');
    const language = requestedLanguages[0] ?? page.languageCode;
    const pageVersion = versionById.get(page.versionId);
    // A non-default version's page links inside its version (the reader adds
    // its slug); a default-version page reaches another version by its slug.
    const routePrefix = pageVersion && !pageVersion.isDefault ? [pageVersion.slug] : [];
    const route = [...routePrefix, ...segments];
    const routePath = route.join('/');
    let versionId = page.versionId;
    let contentSegments = segments;
    const explicit = versions.find((version) => !version.isDefault && version.slug === segments[0]);
    if (routePrefix.length === 0 && explicit) {
      versionId = explicit.id;
      contentSegments = segments.slice(1);
    }
    const contentPath = contentSegments.join('/');

    if (servedIn(versionId, language, contentPath)) return true;
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

const normalizePath = (path: string): string =>
  path
    .split('/')
    .filter(Boolean)
    .map((segment) => safeDecode(segment).normalize('NFC'))
    .join('/');

const brokenLinksBlockPublishing = (snapshot: SiteSnapshot): boolean => {
  const config = snapshot.project.config;
  const addons = config && typeof config.addons === 'object' && config.addons !== null ? (config.addons as Record<string, unknown>) : {};
  // The worker skips every check when CI checks are off and broken links only
  // when that check is off; both default to on.
  return addons.ciChecks !== false && addons.brokenLinks !== false;
};

const SEVERITY_ORDER = { error: 0, warning: 1 } as const;

/** Every check for the snapshot, errors first, then in page order. */
export function collectPublishChecks(snapshot: SiteSnapshot): PublishCheck[] {
  const served = new Set(publicLanguages(snapshot.project.languages).map((language) => language.code));
  // Hidden pages and disabled languages are not published, so nothing on them can mislead a reader.
  const published = snapshot.pages.filter((page) => !page.hidden && served.has(page.languageCode));
  const resolveLink = createLinkResolver(snapshot);
  const linkSeverity = brokenLinksBlockPublishing(snapshot) ? 'error' : 'warning';
  const checks: PublishCheck[] = [];
  const add = (page: SnapshotPage, code: PublishCheckCode, detail = '', severity: PublishCheck['severity'] = 'warning') =>
    checks.push({ code, severity, pageId: page.id, languageCode: page.languageCode, title: page.title, path: page.path, detail });
  const addEach = (page: SnapshotPage, code: PublishCheckCode, details: readonly string[], severity?: PublishCheck['severity']) => {
    for (const detail of [...new Set(details)].slice(0, MAX_PER_PAGE_AND_CODE)) add(page, code, detail, severity);
  };

  const siblingsByTitle = new Map<string, SnapshotPage[]>();
  for (const page of published) {
    if (isPlaceholderTitle(page.title)) {
      add(page, 'untitled-page');
    } else {
      const key = [page.versionId, page.languageCode, page.parentId ?? '', normalizeTitle(page.title).toLocaleLowerCase()].join('\u0000');
      const siblings = siblingsByTitle.get(key) ?? [];
      siblings.push(page);
      siblingsByTitle.set(key, siblings);
    }
    if (isUnreadableSlug(page.slug)) add(page, 'unreadable-slug', page.slug);
    if (page.kind !== 'PAGE') continue;
    if (!hasBody(page.content)) {
      add(page, 'empty-page');
      continue;
    }
    const lines = proseLines(page.content);
    addEach(
      page,
      'broken-internal-link',
      linksIn(lines).filter((href) => resolveLink(href, page) === false),
      linkSeverity,
    );
    addEach(page, 'missing-alt', imagesWithoutAlt(lines));
    addEach(page, 'stray-characters', strayParagraphs(lines));
  }
  for (const siblings of siblingsByTitle.values()) {
    if (siblings.length < 2) continue;
    for (const page of siblings) {
      const other = siblings.find((candidate) => candidate.id !== page.id);
      add(page, 'duplicate-title', other?.path ?? '');
    }
  }

  return checks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]).slice(0, MAX_CHECKS);
}
