/**
 * How the published reader turns a site path into what it serves. This is one
 * pure implementation, used by the reader (the API's page lookup and the page
 * route's not-found fallbacks) and by the pre-publish link checks, so a link
 * the checks accept is a link the reader serves.
 *
 * A language prefix is consumed before the existing version path. Missing
 * translations fall back to the default language. The remaining path resolves
 * to a page/group/home, the API reference, a configured redirect, or not found.
 */
import { normalizeRedirectPath, type RedirectPair, resolveRedirectTarget } from './redirects';
import {
  buildNavTree,
  defaultLanguage,
  isPageTranslation,
  type NavNode,
  publicLanguages,
  type SiteSnapshot,
  type SnapshotPage,
  type SnapshotVersion,
} from './site';
import { type PathLanguage, parseSiteLanguagePath, publishedSitePath } from './site-language';

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

export const pagesForLanguage = (pages: readonly SnapshotPage[], lang: string): SnapshotPage[] => pages.filter((p) => p.languageCode === lang);

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

export const firstPage = (pages: readonly SnapshotPage[], languageCode?: string): SnapshotPage | undefined => {
  const first = flattenNav(buildNavTree(pages, languageCode))[0];
  return first ? pages.find((p) => p.path === first.path) : undefined;
};

export const firstPageUnder = (pages: readonly SnapshotPage[], languageCode: string | undefined, prefix: string): SnapshotPage | undefined => {
  if (!prefix) {
    return undefined;
  }
  const first = flattenNav(buildNavTree(pages, languageCode)).find((node) => node.path.startsWith(`${prefix}/`));
  return first ? pages.find((p) => p.path === first.path) : undefined;
};

export interface ResolvedSitePage {
  page: SnapshotPage;
  /** The resolved language's pages in the resolved docs version. Shared with the
   *  page index (cached per snapshot), so it is read-only. */
  pages: readonly SnapshotPage[];
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
  pages: readonly SnapshotPage[];
  /** The first visible PAGE at each path, in snapshot order. */
  servedByPath: Map<string, SnapshotPage>;
  /** The first page of any kind at each path, in snapshot order. */
  anyByPath: Map<string, SnapshotPage>;
  /** The language's home: the translation of the default language's home,
   *  computed for the home it was asked about (`from`), or null if there's none. */
  homeTranslation?: { from: SnapshotPage; page: SnapshotPage | null };
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

/**
 * A language's home (the site root, `''`): the translation of the default
 * language's home when this language has one (by translation key, else the same
 * path: `isPageTranslation`), so an Arabic reader at the root sees the Arabic
 * version of the English home, not whichever Arabic page sorts first. Without a
 * translation, the language's own first page in nav order. The translation
 * lookup runs once per index and default home.
 */
const indexedHome = (index: LanguagePageIndex, languageCode: string, defaultHome: SnapshotPage | undefined): SnapshotPage | undefined => {
  if (!defaultHome) return indexedFirstPage(index, languageCode);
  if (index.homeTranslation?.from !== defaultHome) {
    const page = index.pages.find((candidate) => candidate.kind === 'PAGE' && !candidate.hidden && isPageTranslation(defaultHome, candidate));
    index.homeTranslation = { from: defaultHome, page: page ?? null };
  }
  return index.homeTranslation.page ?? indexedFirstPage(index, languageCode);
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

  const defaultCode = defaultLanguage(snapshot.project).code;
  const defaultHome = () => indexedFirstPage(languagePageIndex(snapshot, docsVersion, defaultCode), defaultCode);
  const findIn = (langCode: string) => {
    const index = languagePageIndex(snapshot, docsVersion, langCode);
    const found =
      index.servedByPath.get(normalized) ??
      (normalized === '' ? indexedHome(index, langCode, langCode === defaultCode ? undefined : defaultHome()) : undefined) ??
      // A group/section prefix (e.g. a navbar tab pointing at `/guides`)
      // resolves to its first page in nav order, Mintlify-style. Paths with no
      // pages beneath them still 404.
      indexedFirstPageUnder(index, langCode, normalized);
    return found ? { page: found, pages: index.pages } : undefined;
  };

  // Try the active language; fall back to the default language's pages before 404.
  const match = findIn(activeLanguage) ?? (activeLanguage === defaultCode ? undefined : findIn(defaultCode));
  return match ? { ...match, docsVersion, normalized } : null;
};

/** Build the browser-visible Location for one validated internal redirect.
 * Configured query/fragment values are retained. The current locale is carried
 * only when the destination did not deliberately choose another locale. */
export function buildSiteRedirectHref(input: {
  projectId: string;
  target: string;
  lang?: string;
  customDomain: boolean;
  defaultLanguage?: string;
  languages?: readonly PathLanguage[];
}): string {
  const targetUrl = new URL(input.target, 'https://redirect.nibleaf.invalid');
  const target = normalizeRedirectPath(targetUrl.pathname);
  const parsed = parseSiteLanguagePath(target, input.languages ?? []);
  const language = parsed.language?.code ?? targetUrl.searchParams.get('lang') ?? input.lang;
  targetUrl.searchParams.delete('lang');
  const pathname = publishedSitePath(parsed.path, language && language !== input.defaultLanguage ? language : undefined);
  const suffix = `${targetUrl.search}${targetUrl.hash}`;
  return `${input.customDomain ? '' : `/sites/${input.projectId}`}${pathname || (input.customDomain ? '/' : '')}${suffix}`;
}

/** What the reader serves for a site path. A redirect's `to` is a site path
 *  (with its query) or an absolute external URL. */
export type SiteRoute =
  | { kind: 'page'; page: SnapshotPage; resolved: ResolvedSitePage }
  | { kind: 'openapi' }
  | { kind: 'redirect'; to: string; reason: 'configured' }
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
  const parsed = parseSiteLanguagePath(path, publicLanguages(snapshot.project.languages));
  const splat = trimSlashes(parsed.path);
  const lang = parsed.language?.code ?? options.lang;
  // The page route passes the first segment as the version; the lookup only
  // treats it as one when a published version has that slug.
  const version = splat ? splat.split('/')[0] : undefined;
  const resolved = resolveSitePage(snapshot, splat, lang, version);
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
  const configured =
    from === null
      ? null
      : (resolveRedirectTarget(storedRedirects(snapshot), from) ?? resolveRedirectTarget(storedRedirects(snapshot), normalizeRedirectPath(path)));
  if (configured) {
    // External targets redirect verbatim; internal ones as the page route builds
    // them (on a site's own domain, so the path is relative to the site).
    if (/^https?:\/\//i.test(configured)) {
      return { kind: 'redirect', to: configured, reason: 'configured' };
    }
    try {
      const to = buildSiteRedirectHref({
        projectId: snapshot.project.id,
        target: configured,
        lang: lang === defaultLanguage(snapshot.project).code ? undefined : lang,
        customDomain: true,
        defaultLanguage: defaultLanguage(snapshot.project).code,
        languages: snapshot.project.languages,
      });
      return { kind: 'redirect', to, reason: 'configured' };
    } catch {
      // The page route ignores a target it can't build and falls through.
    }
  }
  return { kind: 'not-found' };
}
