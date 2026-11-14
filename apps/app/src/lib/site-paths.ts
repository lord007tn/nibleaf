import { type PathLanguage, parseSiteLanguagePath, publishedSitePath } from '@nibleaf/shared/site-language';
import { customDomainOrigin } from '@/lib/site-origin';

const cleanPath = (path = ''): string => path.replace(/^\/+|\/+$/g, '');

/** decodeURIComponent that keeps a malformed escape (`100%`, a truncated
 *  `%E0%A4`) as typed instead of throwing, so the reader can answer with its
 *  own not-found page. */
export const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

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
  // Whole path segments only: `/git-preview-guide` is a published page.
  if (/^\/(?:app|sign-in|sign-up|forgot-password|reset-password|verify-email|accept-invite|git-preview)(?:\/|$)/.test(pathname)) {
    return false;
  }
  return projectId ? !pathname.startsWith(`/sites/${projectId}`) : !pathname.startsWith('/sites/');
}

/** The pathname a site's URLs hang off: the domain root on a custom domain,
 *  `/sites/:projectId` on the app origin. */
export function siteBasePath(projectId: string, customDomain: boolean): string {
  return customDomain ? '' : `/sites/${projectId}`;
}

/** Remove the internal reader prefix before decoding any URL segments. */
export function siteRoutePath(pathname: string): string {
  return pathname.replace(/^\/sites\/[^/]+(?:\/|$)/, '');
}

/** Omit only a known default language from the public path. */
export function siteLanguageParam(code?: string, defaultCode?: string): string | undefined {
  return code === defaultCode ? undefined : code;
}

export function siteHref(
  projectId: string,
  path = '',
  options?: { lang?: string; version?: string; defaultLanguage?: string; languages?: readonly PathLanguage[] },
): string {
  const { pathname, query, fragment } = splitPath(path);
  const params = new URLSearchParams(query);
  const queryLanguage = params.get('lang');
  const unknownLanguage = queryLanguage && options?.languages && !options.languages.some((item) => item.code === queryLanguage);
  const parsed = parseSiteLanguagePath(cleanPath(pathname), options?.languages ?? []);
  const language = parsed.language?.code ?? (unknownLanguage ? undefined : (queryLanguage ?? options?.lang));
  if (!unknownLanguage) params.delete('lang');
  const version =
    options?.version && (parsed.path === options.version || parsed.path.startsWith(`${options.version}/`)) ? undefined : options?.version;
  const fullPath = publishedSitePath(parsed.path, siteLanguageParam(language || undefined, options?.defaultLanguage), version);
  const prefix = siteBasePath(projectId, isCustomDomainSite(projectId));
  const search = params.toString();
  return `${prefix}${fullPath || (prefix ? '' : '/')}${search ? `?${search}` : ''}${fragment}`;
}
