import { normalizeRedirectPath } from './redirects';
import { type PathLanguage, publishedSitePath, siteLanguagePrefix } from './site-language';

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
  const language = targetUrl.searchParams.get('lang') ?? input.lang;
  const unknown = language && input.languages && !input.languages.some((item) => item.code === language);
  if (unknown) targetUrl.searchParams.set('lang', language);
  else targetUrl.searchParams.delete('lang');
  const pathname = publishedSitePath(
    target,
    !unknown && language && language !== input.defaultLanguage ? siteLanguagePrefix(language, input.languages) : undefined,
  );
  const suffix = `${targetUrl.search}${targetUrl.hash}`;
  return `${input.customDomain ? '' : `/sites/${input.projectId}`}${pathname || (input.customDomain ? '/' : '')}${suffix}`;
}
