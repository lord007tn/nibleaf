/** Base language codes the reader lays out right-to-left. Kept tiny (instead of
 * importing LANGUAGE_CATALOG) because the search shell ships in the first load;
 * a test keeps it equal to the catalog's RTL entries. */
export const RTL_BASE_LANGUAGES: ReadonlySet<string> = new Set(['ar', 'he', 'fa', 'ur']);

/** The published language's configured direction wins; otherwise infer it from the language code. */
export const resolveReaderDirection = (direction?: 'ltr' | 'rtl', language?: string): 'ltr' | 'rtl' => {
  if (direction) return direction;
  const base = language?.toLowerCase().split(/[-_]/)[0] ?? '';
  return RTL_BASE_LANGUAGES.has(base) ? 'rtl' : 'ltr';
};
