import { needsDashboardLocale } from '../src/lib/dashboard-locale-path.ts';

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

const DASHBOARD_CATALOG_MODULE = /\/i18n\/src\/(?:generated\/dashboard\/|dashboard-catalog\.)/;
const SERVER_CATALOG_MODULE = /\/i18n\/src\/dashboard-catalog\.server\.ts$/;
const assetFile = (url) => url.replace(/^\//, '');

/** Startup files, route preloads or not, that carry the all-locale server catalog. */
export function serverCatalogFailures(files, moduleReport) {
  return [...files]
    .filter((file) => (moduleReport.get(assetFile(file)) ?? []).some((module) => SERVER_CATALOG_MODULE.test(module.id)))
    .map((file) => `${file} includes the server catalog.`);
}

/** A route id as a URL: pathless groups dropped, parameters filled in. */
const routePath = (routeId) =>
  routeId
    .split('/')
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => (segment.startsWith('$') ? 'fixture' : segment))
    .join('/') || '/';

/** Routes outside the dashboard family never download a dashboard catalog: they
 *  would hydrate through a catalog nothing prepares for them. */
export function dashboardCatalogRouteFailures(routes, moduleReport) {
  const failures = [];
  for (const [routeId, route] of Object.entries(routes)) {
    if (routeId === '__root__' || needsDashboardLocale(routePath(routeId))) continue;
    for (const preload of route.preloads ?? []) {
      if ((moduleReport.get(assetFile(preload)) ?? []).some((module) => DASHBOARD_CATALOG_MODULE.test(module.id)))
        failures.push(`${routeId} preloads dashboard catalog code in ${preload}.`);
    }
  }
  return failures;
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
