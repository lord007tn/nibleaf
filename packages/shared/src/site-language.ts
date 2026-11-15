/** Public document paths: language, then the existing version path, then page. */
export interface PathLanguage {
  code: string;
  isDefault?: boolean;
  /** Actual URL prefix; escaped only when a bare language code collides. */
  pathPrefix?: string;
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

export const siteLanguagePrefix = (code: string | undefined, languages: readonly PathLanguage[] = []): string | undefined =>
  code ? (languages.find((language) => language.code === code)?.pathPrefix ?? code) : undefined;

/** Match only the published prefix; the root also needs this during navigation. */
export const matchSiteLanguagePrefix = (parts: readonly string[], languages: readonly PathLanguage[]): PathLanguage | undefined =>
  languages.find((item) =>
    (item.pathPrefix ?? item.code)
      .split('/')
      .every((segment, index) => segment.toLowerCase() === decodeSiteSegment(parts[index] ?? '').toLowerCase()),
  );
