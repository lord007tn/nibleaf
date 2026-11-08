/**
 * A readable name for a content language code: the site's own label for it,
 * else the interface language's name for it ("Arabic" / "العربية"), else the
 * code itself (a custom code no one can name). Filters keep the code as their
 * value; only what people read changes.
 */
export function languageName(code: string, siteLanguages: ReadonlyArray<{ code: string; label: string }> | undefined, locale: string): string {
  const site = siteLanguages?.find((language) => language.code === code)?.label?.trim();
  if (site) return site;
  try {
    const named = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(code);
    if (named) return named;
  } catch {
    // Not a valid BCP-47 tag: show it as it is.
  }
  return code;
}
