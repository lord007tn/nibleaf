// Transfer bytes, compressed independently per file with gzip level 9, as in
// the route budget. English may share the translator/key-map chunk.
// Paired build on main 4a054cc4: the largest locale startup is 804,409 bytes
// (Russian); its catalog chunk is 121,690 bytes. Allow modest growth above it.
export const dashboardHomeGzipBudget = 830_000;
export const dashboardLocaleGzipBudget = 125_000;
export const dashboardLocales = ['en', 'ar', 'zh-CN', 'hi', 'es', 'fr', 'bn', 'pt-BR', 'ru', 'ur', 'id', 'de'];

export function dashboardCatalogChunks(chunks) {
  return dashboardLocales.map((locale) => ({
    locale,
    files: chunks
      .filter((chunk) =>
        chunk.modules.some((module) => module.id.replaceAll('\\', '/').endsWith(`/i18n/src/generated/dashboard/messages/${locale}.js`)),
      )
      .map((chunk) => chunk.fileName),
  }));
}

export function dashboardCatalogFailures(catalogs, initialFiles) {
  const failures = [];
  for (const { locale, files, gzip } of catalogs) {
    if (files.length !== 1) failures.push(`${locale}: expected one catalog chunk, found ${files.length}`);
    if (gzip > dashboardLocaleGzipBudget) failures.push(`${locale}: ${gzip} exceeds ${dashboardLocaleGzipBudget} gzip bytes`);
    if (locale !== 'en' && files.some((file) => initialFiles.has(file)))
      failures.push(`${locale}: nonactive catalog is in dashboard-home's initial preloads`);
  }
  const owners = new Map();
  for (const { locale, files } of catalogs) {
    for (const file of files) {
      if (owners.has(file)) failures.push(`${locale}: shares a catalog chunk with ${owners.get(file)}`);
      owners.set(file, locale);
    }
  }
  return failures;
}
