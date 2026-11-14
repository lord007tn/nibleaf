/** Public document paths: language, then the existing version path, then page. */
export interface PathLanguage {
  code: string;
  isDefault: boolean;
}

export const decodeSiteSegment = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export function publishedSitePath(path = '', language?: string, version?: string): string {
  const segments = [language, version, path].filter(Boolean).join('/').split('/').filter(Boolean);
  return segments.length ? `/${segments.map((segment) => encodeURIComponent(decodeSiteSegment(segment))).join('/')}` : '';
}

/** Only published, exact language codes reserve a first segment. */
export function parseSiteLanguagePath(path: string, languages: readonly PathLanguage[]): { path: string; language?: PathLanguage } {
  let start = 0;
  let end = path.length;
  while (start < end && path.charCodeAt(start) === 47) start++;
  while (end > start && path.charCodeAt(end - 1) === 47) end--;
  const clean = path.slice(start, end);
  const slash = clean.indexOf('/');
  const first = slash < 0 ? clean : clean.slice(0, slash);
  const language = languages.find((item) => item.code.toLowerCase() === decodeSiteSegment(first).toLowerCase());
  return { path: language ? (slash < 0 ? '' : clean.slice(slash + 1)) : clean, language };
}

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
  if (!requested && !parsed.language?.isDefault) return null;
  // Unknown query languages keep today's fallback behavior. A real prefix wins.
  if (code && !requested) return null;
  const language = parsed.language ?? requested;
  if (!language) return null;
  const path = parsed.path;
  if (path.split('/').some((part) => /[/\\]/.test(decodeSiteSegment(part)) || ['.', '..'].includes(decodeSiteSegment(part)))) return null;
  params.delete('lang');
  const rootMarkdown = path === '_index.md';
  const contentPath = rootMarkdown && !language.isDefault ? '' : path;
  const pathname =
    `${input.basePath}${publishedSitePath(contentPath, language.isDefault ? undefined : language.code)}${rootMarkdown && !language.isDefault ? '.md' : ''}` ||
    '/';
  // basePath is an application-owned path, never a URL supplied by the visitor.
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ''}${input.hash ? `#${input.hash.replace(/^#/, '')}` : ''}`;
}
