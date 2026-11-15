import { publishedSitePath, siteLanguagePrefix } from '@nibleaf/shared/site-language';
import { parseSiteLanguagePath } from '@nibleaf/shared/site-language-prefix';
import { type SiteHrefOptions, siteHref, siteLanguageParam } from './site-paths';

/** Absolute internal URLs already contain their public language/version path. */
export function authoredSiteHref(projectId: string, path: string, options: SiteHrefOptions = {}): string {
  const url = new URL(path, 'https://site.invalid');
  const code = url.searchParams.get('lang');
  const unknown = code && options.languages && !options.languages.some((item) => item.code === code);
  const parsed = parseSiteLanguagePath(url.pathname, code && !unknown ? [] : (options.languages ?? []));
  const language = parsed.language?.code ?? (unknown ? undefined : (code ?? options.lang));
  if (!unknown) url.searchParams.delete('lang');
  const fullPath = publishedSitePath(
    parsed.path,
    siteLanguagePrefix(siteLanguageParam(language || undefined, options.defaultLanguage), options.languages),
  );
  return `${siteHref(projectId, fullPath)}${url.search}${url.hash}`;
}
