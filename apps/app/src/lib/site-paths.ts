import { customDomainOrigin } from '@/lib/site-origin';

const cleanPath = (path = ''): string => path.replace(/^\/+|\/+$/g, '');

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Percent-encode one path segment exactly once: a raw Arabic slug from the
 *  snapshot and an already-encoded segment from an authored link both come out
 *  encoded a single time, so the route's decoded splat matches `page.path`. */
const encodeSegment = (segment: string): string => encodeURIComponent(safeDecode(segment));

/** Split an authored path into its pathname and the `?query#fragment` tail so
 *  only the pathname is encoded and anchors/queries survive untouched. */
const splitPath = (path: string): { pathname: string; query: string; fragment: string } => {
  const hashAt = path.indexOf('#');
  const beforeHash = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const fragment = hashAt >= 0 ? path.slice(hashAt) : '';
  const queryAt = beforeHash.indexOf('?');
  return {
    pathname: queryAt >= 0 ? beforeHash.slice(0, queryAt) : beforeHash,
    query: queryAt >= 0 ? beforeHash.slice(queryAt) : '',
    fragment,
  };
};

export function isCustomDomainSite(projectId?: string): boolean {
  if (customDomainOrigin()) {
    return true;
  }
  if (typeof window === 'undefined') {
    return false;
  }
  const pathname = window.location.pathname;
  if (/^\/(app|sign-in|sign-up|forgot-password|reset-password|verify-email|accept-invite)\b/.test(pathname)) {
    return false;
  }
  return projectId ? !pathname.startsWith(`/sites/${projectId}`) : !pathname.startsWith('/sites/');
}

/** The pathname a site's URLs hang off: the domain root on a custom domain,
 *  `/sites/:projectId` on the app origin. */
export function siteBasePath(projectId: string, customDomain: boolean): string {
  return customDomain ? '' : `/sites/${projectId}`;
}

export function siteHref(projectId: string, path = '', options?: { lang?: string; version?: string }): string {
  const { pathname, query, fragment } = splitPath(path);
  const fullPath = [options?.version, cleanPath(pathname)].filter(Boolean).join('/').split('/').filter(Boolean).map(encodeSegment).join('/');
  const prefix = siteBasePath(projectId, isCustomDomainSite(projectId));
  const langParam = options?.lang ? `lang=${encodeURIComponent(options.lang)}` : '';
  const search = langParam ? `${query ? `${query}&` : '?'}${langParam}` : query;
  const href = `${prefix}${fullPath ? `/${fullPath}` : ''}` || '/';
  return `${href}${search}${fragment}`;
}
