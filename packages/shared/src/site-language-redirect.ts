import { decodeSiteSegment, type PathLanguage, publishedSitePath, siteLanguagePrefix } from './site-language';
import { parseSiteLanguagePath } from './site-language-prefix';

/** Same-host, root-relative migration target. No fragment means HTTP clients
 * inherit the old fragment; client-router redirects must append their hash. */
export function legacySiteLanguageTarget(input: {
  path: string;
  languages: readonly PathLanguage[];
  basePath: string;
  search?: string;
  hash?: string;
}): string | null {
  const params = new URLSearchParams(input.search);
  const parsed = parseSiteLanguagePath(input.path, input.languages);
  const code = params.get('lang');
  const requested = input.languages.find((item) => item.code === code);
  if (code && !requested) return null;
  // A legacy query selects language for the FULL old path, even when its
  // first segment happens to be a language code or version slug.
  const language = requested ?? (parsed.language?.isDefault ? parsed.language : undefined);
  if (!language) return null;
  const path = requested ? input.path : parsed.path;
  if (path.split('/').some((part) => /[/\\]/.test(decodeSiteSegment(part)) || ['.', '..'].includes(decodeSiteSegment(part)))) return null;
  params.delete('lang');
  const rootMarkdown = path === '_index.md';
  const contentPath = rootMarkdown && !language.isDefault ? '' : path;
  const pathname =
    `${input.basePath}${publishedSitePath(contentPath, language.isDefault ? undefined : siteLanguagePrefix(language.code, input.languages))}${rootMarkdown && !language.isDefault ? '.md' : ''}` ||
    '/';
  // basePath is an application-owned path, never a URL supplied by the visitor.
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ''}${input.hash ? `#${input.hash.replace(/^#/, '')}` : ''}`;
}
