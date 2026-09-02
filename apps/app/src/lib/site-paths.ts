import { customDomainOrigin } from '@/lib/site-origin';

const cleanPath = (path = ''): string => path.replace(/^\/+|\/+$/g, '');

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
  const fullPath = [options?.version, cleanPath(path)].filter(Boolean).join('/');
  const prefix = siteBasePath(projectId, isCustomDomainSite(projectId));
  const query = options?.lang ? `?lang=${encodeURIComponent(options.lang)}` : '';
  const pathname = `${prefix}${fullPath ? `/${fullPath}` : ''}` || '/';
  return `${pathname}${query}`;
}
