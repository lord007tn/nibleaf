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

export function siteHref(projectId: string, path = '', options?: { lang?: string; version?: string }): string {
  const fullPath = [options?.version, cleanPath(path)].filter(Boolean).join('/');
  const prefix = isCustomDomainSite(projectId) ? '' : `/sites/${projectId}`;
  const query = options?.lang ? `?lang=${encodeURIComponent(options.lang)}` : '';
  return `${prefix}${fullPath ? `/${fullPath}` : ''}${query}` || `/${query}`;
}
