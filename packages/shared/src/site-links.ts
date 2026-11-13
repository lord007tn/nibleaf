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

/** Turn a known import source's absolute page URL into a site reference.
 * Origins are compared whole; another site's /pages/ route is still external. */
export const importSiteHref = (href: string, sourceUrl?: string, appOrigins: readonly string[] = []): string => {
  if (!/^https?:\/\//i.test(href)) return href;
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }
  if (url.username || url.password) return href;
  const source = sourceUrl && URL.canParse(sourceUrl) ? new URL(sourceUrl) : undefined;
  if (appOrigins.includes(url.origin) && url.pathname.startsWith('/pages/')) {
    return `${url.pathname.slice('/pages'.length)}${url.search}${url.hash}`;
  }
  return source?.origin === url.origin ? `${url.pathname}${url.search}${url.hash}` : href;
};

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

/** Where a site path leads, and the fragment the redirects on the way set
 *  (the last one that set one), if any. */
interface Reached {
  destination: boolean | SnapshotPage;
  fragment?: string;
}

/** Follow what the reader serves for a site path, through configured and
 *  language-prefix redirects (bounded like redirect chains). A redirect is a
 *  Location, so as in a browser a destination's fragment replaces the one the
 *  link carried, and a destination without one keeps it. */
const reaches = (snapshot: SiteSnapshot, startPath: string, startLang: string | undefined): Reached => {
  let path = startPath;
  let lang = startLang;
  let fragment: string | undefined;
  for (let hop = 0; hop <= MAX_REDIRECT_CHAIN_LENGTH; hop++) {
    if (RESERVED_ROUTES.has(path)) return { destination: true, fragment };
    const route = resolveSiteRoute(snapshot, path, { lang });
    if (route.kind === 'page') return { destination: route.page, fragment };
    if (route.kind === 'openapi') return { destination: true, fragment };
    if (route.kind === 'not-found') return { destination: false };
    if (/^https?:\/\//i.test(route.to)) return { destination: true };
    const target = new URL(route.to, 'https://site.invalid');
    if (target.hash.length > 1) fragment = target.hash.slice(1);
    path = target.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => safeDecode(segment).normalize('NFC'))
      .join('/');
    lang = searchLanguage(target.searchParams);
  }
  return { destination: false };
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
  const resolve = createLinkTargetResolver(snapshot);
  return (href: string, page: SnapshotPage, siteAbsolute = false): boolean | SnapshotPage | null =>
    resolve(href, page, siteAbsolute)?.destination ?? null;
};

/**
 * `createLinkResolver`, also giving the fragment the reader lands on: the
 * link's own (`setup#install`), unless a redirect on the way sets another
 * (`old-setup` → `guides/setup#install`). Raw, as written (not decoded).
 */
export const createLinkTargetResolver = (snapshot: SiteSnapshot) => {
  const defaultCode = publicLanguages(snapshot.project.languages).find((language) => language.isDefault)?.code;
  const versionById = new Map(snapshot.project.versions.map((version) => [version.id, version]));
  // A site's shared navigation links repeat across many bodies. Normalize in
  // the source page's context first, then resolve each destination only once
  // per immutable snapshot scan (including redirect chains).
  const destinations = new Map<string, Reached>();
  return (href: string, page: SnapshotPage, siteAbsolute = false): Reached | null => {
    const trimmed = href.trim();
    const hashAt = trimmed.indexOf('#');
    const linkFragment = hashAt >= 0 && hashAt < trimmed.length - 1 ? trimmed.slice(hashAt + 1) : undefined;
    const withFragment = (reached: Reached): Reached =>
      reached.destination === false ? reached : { destination: reached.destination, fragment: reached.fragment ?? linkFragment };
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
    if (cached !== undefined) return withFragment(cached);
    const reached = reaches(snapshot, path, lang);
    destinations.set(key, reached);
    return withFragment(reached);
  };
};
