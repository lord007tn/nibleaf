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
  const explicitVersion = matchingVersion(snapshot, version);
  const normalized = trimSlashes(path);
  if (explicitVersion && (normalized === explicitVersion.slug || normalized.startsWith(`${explicitVersion.slug}/`))) {
    return trimLeadingSlashes(normalized.slice(explicitVersion.slug.length));
  }
  return normalized;
};

export const resolveSitePage = (snapshot: SiteSnapshot, path: string, lang?: string, version?: string): ResolvedSitePage | null => {
  const explicitVersion = matchingVersion(snapshot, version);
  const normalized = sitePathWithinVersion(snapshot, path, version);
  const activeLanguage = activeLanguageCode(snapshot, lang);
  const docsVersion = explicitVersion ?? activeVersion(snapshot, version);
  const versionPages = pagesForVersion(snapshot, docsVersion);

  const findIn = (langCode: string) => {
    const langPages = pagesForLanguage(versionPages, langCode);
    const found =
      langPages.find((p) => p.path === normalized && p.kind === 'PAGE' && !p.hidden) ??
      (normalized === '' ? firstPage(langPages, langCode) : undefined) ??
      // A group/section prefix (e.g. a navbar tab pointing at `/guides`)
      // resolves to its first page in nav order, Mintlify-style. Paths with no
      // pages beneath them still 404.
      firstPageUnder(langPages, langCode, normalized);
    return found ? { page: found, pages: langPages } : undefined;
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
  | { kind: 'not-found' };

const storedRedirects = (snapshot: SiteSnapshot): RedirectPair[] => {
  const raw = (snapshot.project.config as { redirects?: unknown } | null)?.redirects;
  return (Array.isArray(raw) ? raw : []).filter((rule): rule is RedirectPair => typeof rule?.from === 'string' && typeof rule?.to === 'string');
};

/**
 * What the reader serves for `path` (relative to the site, any version prefix
 * included) with `?lang=` set to `lang`, in the page route's order.
 */
export function resolveSiteRoute(snapshot: SiteSnapshot, path: string, options: { lang?: string } = {}): SiteRoute {
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
