/**
 * How the published reader turns a site path into what it serves. This is one
 * pure implementation, used by the reader (the API's page lookup and the page
 * route's not-found fallbacks) and by the pre-publish link checks, so a link
 * the checks accept is a link the reader serves.
 *
 * The order follows the page route (`apps/app/src/routes/sites/$projectId/$.tsx`):
 *   1. the page itself: the first segment selects a docs version when it is one
 *      (and is stripped); the language comes from `?lang=` (an unknown one means
 *      the default); a missing translation falls back to the default language;
 *      a group prefix resolves to its first page; the empty path to the first page;
 *   2. the API reference at its configured path;
 *   3. a configured redirect for the whole path;
 *   4. a language prefix in the FIRST segment of the path (`/ar/guide`), which
 *      redirects to the `?lang=` form;
 *   5. otherwise not found.
 */
import { normalizeRedirectPath, type RedirectPair, resolveRedirectTarget } from './redirects';
import { buildNavTree, defaultLanguage, type NavNode, publicLanguages, type SiteSnapshot, type SnapshotPage, type SnapshotVersion } from './site';

const SLASH = 47;

/** The longest site path the reader serves (a common URL length limit). Longer
 *  paths are rejected before any work: the reader answers 404, and the
 *  pre-publish checks report the link as too long. This bounds every lookup on
 *  author content and on reader requests. */
export const MAX_SITE_PATH_LENGTH = 2048;

export const sitePathTooLong = (path: string): boolean => path.length > MAX_SITE_PATH_LENGTH;

/** `value` without leading and trailing `/`, in one linear pass. A regex such
 *  as `^\/+|\/+$` backtracks polynomially on long runs of slashes, and this
 *  runs on every reader request and on authored links at publish time. */
export const trimSlashes = (value: string): string => {
  let start = 0;
  let end = value.length;
  while (start < end && value.charCodeAt(start) === SLASH) start++;
  while (end > start && value.charCodeAt(end - 1) === SLASH) end--;
  return value.slice(start, end);
};

const trimLeadingSlashes = (value: string): string => {
  let start = 0;
  while (start < value.length && value.charCodeAt(start) === SLASH) start++;
  return value.slice(start);
};

/** Depth-first order of renderable pages — for prev/next links. */
export const flattenNav = (nav: NavNode[]): NavNode[] =>
  nav.flatMap((node) => (node.kind === 'PAGE' ? [node, ...flattenNav(node.children)] : flattenNav(node.children)));

export const activeLanguageCode = (snapshot: SiteSnapshot, lang?: string): string => {
  if (lang && publicLanguages(snapshot.project.languages).some((l) => l.code === lang)) {
    return lang;
  }
  return defaultLanguage(snapshot.project).code;
};

export const pagesForLanguage = (pages: SnapshotPage[], lang: string): SnapshotPage[] => pages.filter((p) => p.languageCode === lang);

export const defaultVersion = (snapshot: SiteSnapshot): SnapshotVersion => {
  const defaults = snapshot.project.versions.filter((version) => version.isDefault);
  if (defaults.length !== 1 || !defaults[0]) {
    throw new Error(`Snapshot project ${snapshot.project.id} must have exactly one default version.`);
  }
  return defaults[0];
};

export const activeVersion = (snapshot: SiteSnapshot, version?: string): SnapshotVersion => {
  const requested = version?.trim();
  if (requested) {
    const match = snapshot.project.versions.find((candidate) => candidate.slug === requested);
    if (match) {
      return match;
    }
  }
  return defaultVersion(snapshot);
};

export const matchingVersion = (snapshot: SiteSnapshot, version?: string): SnapshotVersion | undefined => {
  const requested = version?.trim();
  if (!requested) {
    return undefined;
  }
  return snapshot.project.versions.find((candidate) => candidate.slug === requested);
};

export const pageBelongsToVersion = (page: SnapshotPage, version: SnapshotVersion): boolean => page.versionId === version.id;

export const pagesForVersion = (snapshot: SiteSnapshot, version: SnapshotVersion): SnapshotPage[] =>
  snapshot.pages.filter((page) => pageBelongsToVersion(page, version));

export const firstPage = (pages: SnapshotPage[], languageCode?: string): SnapshotPage | undefined => {
  const first = flattenNav(buildNavTree(pages, languageCode))[0];
  return first ? pages.find((p) => p.path === first.path) : undefined;
};

export const firstPageUnder = (pages: SnapshotPage[], languageCode: string | undefined, prefix: string): SnapshotPage | undefined => {
  if (!prefix) {
    return undefined;
  }
  const first = flattenNav(buildNavTree(pages, languageCode)).find((node) => node.path.startsWith(`${prefix}/`));
  return first ? pages.find((p) => p.path === first.path) : undefined;
};

export interface ResolvedSitePage {
  page: SnapshotPage;
  /** The resolved language's pages in the resolved docs version. */
  pages: SnapshotPage[];
  docsVersion: SnapshotVersion;
  /** The requested path with the version prefix removed. */
  normalized: string;
}

/**
 * The page the reader's API serves for `path` (version prefix included), or
 * null when it serves none. Scoped to the requested language, falling back to
 * the default language.
 */
/** The path without slashes at either end, and without the version's slug when
 *  `version` names a published version and the path starts with it. */
export const sitePathWithinVersion = (snapshot: SiteSnapshot, path: string, version?: string): string => {
  if (sitePathTooLong(path)) return path.slice(0, MAX_SITE_PATH_LENGTH);
  const explicitVersion = matchingVersion(snapshot, version);
  const normalized = trimSlashes(path);
  if (explicitVersion && (normalized === explicitVersion.slug || normalized.startsWith(`${explicitVersion.slug}/`))) {
    return trimLeadingSlashes(normalized.slice(explicitVersion.slug.length));
  }
  return normalized;
};

/** One version and language's pages, with the lookups `resolveSitePage` makes,
 *  built once: each is what the matching linear scan over `pages` returns. */
interface LanguagePageIndex {
  pages: SnapshotPage[];
  /** The first visible PAGE at each path, in snapshot order. */
  servedByPath: Map<string, SnapshotPage>;
  /** The first page of any kind at each path, in snapshot order. */
  anyByPath: Map<string, SnapshotPage>;
  /** The first page in nav order (`firstPage`), once computed. */
  first?: SnapshotPage | null;
  /** For every proper path prefix, the path of the first page beneath it in nav order (`firstPageUnder`), once computed. */
  firstUnder?: Map<string, string>;
}

/** Page lookups per snapshot. A link check resolves every link on every page, so
 *  scanning the pages per lookup made a site's checks cost pages × links. Keyed by
 *  the snapshot's pages array (snapshots are immutable once built), and rebuilt
 *  if that array's length changes. */
const pageIndexes = new WeakMap<SnapshotPage[], { length: number; byScope: Map<string, LanguagePageIndex> }>();

const languagePageIndex = (snapshot: SiteSnapshot, version: SnapshotVersion, languageCode: string): LanguagePageIndex => {
  let entry = pageIndexes.get(snapshot.pages);
  if (!entry || entry.length !== snapshot.pages.length) {
    entry = { length: snapshot.pages.length, byScope: new Map() };
    pageIndexes.set(snapshot.pages, entry);
  }
  const key = `${version.id}\u0000${languageCode}`;
  const known = entry.byScope.get(key);
  if (known) return known;
  const pages = pagesForLanguage(pagesForVersion(snapshot, version), languageCode);
  const servedByPath = new Map<string, SnapshotPage>();
  const anyByPath = new Map<string, SnapshotPage>();
  for (const page of pages) {
    if (!anyByPath.has(page.path)) anyByPath.set(page.path, page);
    if (page.kind === 'PAGE' && !page.hidden && !servedByPath.has(page.path)) servedByPath.set(page.path, page);
  }
  const index: LanguagePageIndex = { pages, servedByPath, anyByPath };
  entry.byScope.set(key, index);
  return index;
};

/** `firstPage(pages, languageCode)`, computed once per index. */
const indexedFirstPage = (index: LanguagePageIndex, languageCode: string): SnapshotPage | undefined => {
  if (index.first === undefined) index.first = firstPage(index.pages, languageCode) ?? null;
  return index.first ?? undefined;
};

/** `firstPageUnder(pages, languageCode, prefix)`, answered from one pass over the nav. */
const indexedFirstPageUnder = (index: LanguagePageIndex, languageCode: string, prefix: string): SnapshotPage | undefined => {
  if (!prefix) return undefined;
  if (!index.firstUnder) {
    const firstUnder = new Map<string, string>();
    for (const node of flattenNav(buildNavTree(index.pages, languageCode))) {
      // Every proper prefix `p` with node.path.startsWith(`${p}/`): the path up to each slash.
      for (let slash = node.path.indexOf('/'); slash >= 0; slash = node.path.indexOf('/', slash + 1)) {
        const ancestor = node.path.slice(0, slash);
        if (!firstUnder.has(ancestor)) firstUnder.set(ancestor, node.path);
      }
    }
    index.firstUnder = firstUnder;
  }
  const path = index.firstUnder.get(prefix);
  return path === undefined ? undefined : index.anyByPath.get(path);
};

export const resolveSitePage = (snapshot: SiteSnapshot, path: string, lang?: string, version?: string): ResolvedSitePage | null => {
  if (sitePathTooLong(path)) return null;
  const explicitVersion = matchingVersion(snapshot, version);
  const normalized = sitePathWithinVersion(snapshot, path, version);
  const activeLanguage = activeLanguageCode(snapshot, lang);
  const docsVersion = explicitVersion ?? activeVersion(snapshot, version);

  const findIn = (langCode: string) => {
    const index = languagePageIndex(snapshot, docsVersion, langCode);
    const found =
      index.servedByPath.get(normalized) ??
      (normalized === '' ? indexedFirstPage(index, langCode) : undefined) ??
      // A group/section prefix (e.g. a navbar tab pointing at `/guides`)
      // resolves to its first page in nav order, Mintlify-style. Paths with no
      // pages beneath them still 404.
      indexedFirstPageUnder(index, langCode, normalized);
    return found ? { page: found, pages: index.pages } : undefined;
  };

  // Try the active language; fall back to the default language's pages before 404.
  const defaultCode = defaultLanguage(snapshot.project).code;
  const match = findIn(activeLanguage) ?? (activeLanguage === defaultCode ? undefined : findIn(defaultCode));
  return match ? { ...match, docsVersion, normalized } : null;
};

export interface SiteLanguageCandidate {
  code: string;
  isDefault: boolean;
}

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const baseCode = (code: string): string => code.split('-')[0] ?? code;

/**
 * Match one URL path segment against the site's language codes: an exact
 * (case-insensitive) match wins, then the language whose base code equals the
 * segment (`ar` → `ar-SA`). Returns the site's own code so `?lang=` carries the
 * exact value the API resolves.
 */
export function matchSiteLanguage<T extends SiteLanguageCandidate>(segment: string, languages: ReadonlyArray<T>): T | undefined {
  const wanted = safeDecode(segment).trim().toLowerCase();
  if (!wanted) {
    return undefined;
  }
  return (
    languages.find((language) => language.code.toLowerCase() === wanted) ??
    languages.find((language) => baseCode(language.code).toLowerCase() === wanted)
  );
}

export interface LanguagePathTargetInput {
  /** The page route's splat (everything after the site base), encoded or decoded. */
  splat: string;
  languages: ReadonlyArray<SiteLanguageCandidate>;
  /** The site's base path (`/sites/<id>` on the app host, '' on a site's own domain). */
  basePath: string;
  /** The current search string (with or without the leading `?`); other params survive. */
  search?: string;
}

/**
 * The published site selects its language via `?lang=<code>`, but visitors (and
 * links from Mintlify-style sites) commonly guess `/ar` or `/ar/guides`. When
 * the first path segment is one of the site's language codes, return the
 * equivalent `?lang=` URL — or null when the path isn't a language prefix.
 *
 * The default language's clean URL is canonical (no `?lang`), so `/en/...`
 * drops the param instead of pinning it. Other search params are preserved; an
 * existing `?lang=` is overridden by the language named in the path.
 */
export function languagePathTarget(input: LanguagePathTargetInput): string | null {
  if (sitePathTooLong(input.splat)) {
    return null;
  }
  const [first, ...rest] = input.splat.split('/').filter(Boolean);
  if (!first) {
    return null;
  }
  const language = matchSiteLanguage(first, input.languages);
  if (!language) {
    return null;
  }
  const params = new URLSearchParams(input.search ?? '');
  if (language.isDefault) {
    params.delete('lang');
  } else {
    params.set('lang', language.code);
  }
  // Re-encode segment by segment so encoded and decoded (Arabic) slugs both
  // yield one valid Location.
  const path = rest.map((segment) => encodeURIComponent(safeDecode(segment))).join('/');
  const pathname = `${input.basePath}${path ? `/${path}` : ''}` || '/';
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}

/** Build the browser-visible Location for one validated internal redirect.
 * Configured query/fragment values are retained. The current locale is carried
 * only when the destination did not deliberately choose another locale. */
export function buildSiteRedirectHref(input: { projectId: string; target: string; lang?: string; customDomain: boolean }): string {
  const targetUrl = new URL(input.target, 'https://redirect.nibleaf.invalid');
  const target = normalizeRedirectPath(targetUrl.pathname);
  if (input.lang && !targetUrl.searchParams.has('lang')) {
    targetUrl.searchParams.set('lang', input.lang);
  }
  const suffix = `${targetUrl.search}${targetUrl.hash}`;
  if (input.customDomain) {
    return `/${target}${suffix}`;
  }
  return `/sites/${input.projectId}${target ? `/${target}` : ''}${suffix}`;
}

/** What the reader serves for a site path. A redirect's `to` is a site path
 *  (with its query) or an absolute external URL. */
export type SiteRoute =
  | { kind: 'page'; page: SnapshotPage; resolved: ResolvedSitePage }
  | { kind: 'openapi' }
  | { kind: 'redirect'; to: string; reason: 'configured' | 'language-prefix' }
  | { kind: 'not-found'; reason?: 'path-too-long' };

const storedRedirects = (snapshot: SiteSnapshot): RedirectPair[] => {
  const raw = (snapshot.project.config as { redirects?: unknown } | null)?.redirects;
  return (Array.isArray(raw) ? raw : []).filter((rule): rule is RedirectPair => typeof rule?.from === 'string' && typeof rule?.to === 'string');
};

/**
 * What the reader serves for `path` (relative to the site, any version prefix
 * included) with `?lang=` set to `lang`, in the page route's order.
 */
export function resolveSiteRoute(snapshot: SiteSnapshot, path: string, options: { lang?: string } = {}): SiteRoute {
  if (sitePathTooLong(path)) {
    return { kind: 'not-found', reason: 'path-too-long' };
  }
  const splat = trimSlashes(path);
  // The page route passes the first segment as the version; the lookup only
  // treats it as one when a published version has that slug.
  const version = splat ? splat.split('/')[0] : undefined;
  const resolved = resolveSitePage(snapshot, splat, options.lang, version);
  if (resolved) {
    return { kind: 'page', page: resolved.page, resolved };
  }
  if (snapshot.openapi && splat === trimSlashes(snapshot.openapi.path)) {
    return { kind: 'openapi' };
  }
  let from: string | null = null;
  try {
    from = normalizeRedirectPath(splat);
  } catch {
    from = null;
  }
  const configured = from === null ? null : resolveRedirectTarget(storedRedirects(snapshot), from);
  if (configured) {
    // External targets redirect verbatim; internal ones as the page route builds
    // them (on a site's own domain, so the path is relative to the site).
    if (/^https?:\/\//i.test(configured)) {
      return { kind: 'redirect', to: configured, reason: 'configured' };
    }
    try {
      const to = buildSiteRedirectHref({ projectId: snapshot.project.id, target: configured, lang: options.lang, customDomain: true });
      return { kind: 'redirect', to, reason: 'configured' };
    } catch {
      // The page route ignores a target it can't build and falls through.
    }
  }
  const languageTarget = languagePathTarget({
    splat,
    languages: publicLanguages(snapshot.project.languages),
    basePath: '',
    search: options.lang ? `lang=${encodeURIComponent(options.lang)}` : '',
  });
  if (languageTarget) {
    return { kind: 'redirect', to: languageTarget, reason: 'language-prefix' };
  }
  return { kind: 'not-found' };
}
