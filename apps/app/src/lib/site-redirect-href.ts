import { normalizeRedirectPath } from '@nibleaf/shared/redirects';

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
