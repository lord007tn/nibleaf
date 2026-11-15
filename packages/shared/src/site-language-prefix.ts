import { decodeSiteSegment, matchSiteLanguagePrefix, type PathLanguage } from './site-language';

/** Consume a published prefix, including a collision escape marker. */
export function parseSiteLanguagePath(path: string, languages: readonly PathLanguage[]): { path: string; language?: PathLanguage } {
  let start = 0;
  let end = path.length;
  while (start < end && path.charCodeAt(start) === 47) start++;
  while (end > start && path.charCodeAt(end - 1) === 47) end--;
  const clean = path.slice(start, end);
  const parts = clean.split('/');
  const language = matchSiteLanguagePrefix(parts, languages);
  const count = language ? (language.pathPrefix ?? language.code).split('/').length : 0;
  return { path: parts.slice(count).join('/'), language };
}

/** Legacy guessed prefixes are aliases only AFTER real content/version lookup. */
export function parseSiteLanguageAlias(path: string, languages: readonly PathLanguage[]): { path: string; language?: PathLanguage } {
  const parts = path.split('/').filter(Boolean);
  const wanted = decodeSiteSegment(parts[0] ?? '')
    .trim()
    .toLowerCase();
  const language = wanted
    ? (languages.find((item) => item.code.toLowerCase() === wanted) ?? languages.find((item) => item.code.split('-')[0]?.toLowerCase() === wanted))
    : undefined;
  return { path: language ? parts.slice(1).join('/') : path, language };
}
