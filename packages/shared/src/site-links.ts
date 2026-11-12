/**
 * Where an authored internal link leads on the published site: the link is
 * rendered as the reader renders it (relative to the page URL, or
 * root-relative with the page's version prefix and language), then resolved
 * with `resolveSiteRoute`, the reader's own route order, following redirects.
 *
 * Browser-safe (no Markdown parsing, no Node APIs): the pre-publish checks
 * (`./publish-checks`, server and worker) and the dashboard editor, which
 * opens a linked page in place, use this one implementation.
 */
import { MAX_REDIRECT_CHAIN_LENGTH } from './redirects';
import { publicLanguages, type SiteSnapshot, type SnapshotPage } from './site';
import { resolveSiteRoute } from './site-route';

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
export const createLinkResolver = (snapshot: SiteSnapshot) => {
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
