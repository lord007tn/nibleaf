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

/**
 * `code`'s name in `locale`, or null when the platform has no data for that
 * locale. `new Intl.DisplayNames([locale])` never fails for a valid but
 * unsupported locale: it silently falls back to the default (`la` resolves to
 * en-US and names itself "Latin"), so support is checked first.
 */
export const languageNameIn = (locale: string, code: string): string | null => {
  try {
    if (Intl.DisplayNames.supportedLocalesOf([locale]).length === 0) return null;
    const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(code);
    return name && name !== code ? name : null;
  } catch {
    // An invalid tag (`x-klingon`).
    return null;
  }
};

/**
 * A language's own name in its own script ("العربية", "Français", "Deutsch"),
 * capitalized as a menu label. Null when the platform can't name it in its own
 * locale (a private-use tag, or a locale without data such as `la`), so the
 * caller keeps the stored label ("Latina").
 */
export const languageEndonym = (code: string): string | null => {
  const name = languageNameIn(code, code);
  return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : null;
};
