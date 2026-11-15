import type { SiteSnapshot } from './site';
import { decodeSiteSegment } from './site-language';

/** Bare content/version/redirect paths keep their pre-migration meaning.
 * Compute from the complete snapshot, before any reader page filtering. */
export function sitePathLanguages(snapshot: SiteSnapshot) {
  const first = (path: string) => decodeSiteSegment(path.replace(/^\/+/, '').split('/')[0] ?? '').toLowerCase();
  const defaultCode = snapshot.project.languages.find((language) => language.isDefault)?.code;
  const reserved = new Set(snapshot.pages.filter((page) => page.languageCode === defaultCode).map((page) => first(page.path)));
  for (const version of snapshot.project.versions) reserved.add(first(version.slug));
  if (snapshot.openapi) reserved.add(first(snapshot.openapi.path));
  const redirects = (snapshot.project.config as { redirects?: Array<{ from?: string }> } | null)?.redirects;
  if (Array.isArray(redirects)) for (const rule of redirects) if (typeof rule?.from === 'string') reserved.add(first(rule.from));
  let marker = '~lang';
  while (reserved.has(marker)) marker += '~';
  return snapshot.project.languages.map((language) => ({
    ...language,
    pathPrefix: language.pathPrefix ?? (reserved.has(language.code.toLowerCase()) ? `${marker}/${language.code}` : language.code),
  }));
}
