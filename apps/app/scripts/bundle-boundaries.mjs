import { KNOWN_MARKETING_READER_ICONS } from './reader-icons.ts';

// Modules that must never reach a published docs page, and the route-module
// bytes that do. `check-bundle-budget.mjs` applies both to the module report
// that `BUNDLE_ANALYZE=true` builds write; see BUNDLE_BUDGET.md.

// Marketing pages, the blog and their copy, and dashboard data code must never
// reach a published docs page. Route files are the usual leak: anything a route
// file exports, and its non-split options (head, validateSearch, beforeLoad, and
// the reader's loaders), stay in the router's eager chunk, which every
// page loads. Every profile includes the `__root__` route, so root preloads are
// covered too.
const forbiddenPublicModules = [
  /\/apps\/app\/src\/components\/(?:cloud-marketing\.tsx|marketing\/)/,
  /\/apps\/app\/src\/lib\/blog-(?:manifest|seo)\.ts$/,
  /\/packages\/i18n\/src\/paraglide\/messages\/(?:marketing|blog)_/,
  // Marketing SEO helpers, organization facts, FAQ copy and comparison data.
  // Marketing routes build their head in the loader from a lazy import. The
  // root route decides whether to load marketing analytics on every page, so
  // that one check is allowed.
  /\/apps\/app\/src\/lib\/(?:marketing-(?!analytics-route\.ts$)|comparison-)/,
  /\/apps\/app\/src\/functions\/marketing\.ts$/,
  // Dashboard loaders are split (vite.config.ts), so their query factories and
  // prefetch helpers stay out. Analytics and AI search validators are allowed:
  // validateSearch can't be split.
  /\/apps\/app\/src\/hooks\/api\/(?:index|query-options|mutations|route-prefetch|deployment-cache|analytics\/)/,
  /\/apps\/app\/src\/components\/(?:app|project|project-settings|settings|editor|oauth)\//,
  /\/apps\/app\/src\/components\/analytics\/(?!insights\/filters\.ts$)/,
  /\/apps\/app\/src\/components\/ai-conversations\/(?!search\.ts$)/,
  // Route ids and validateSearch parsers stay in non-split route options.
  /\/apps\/app\/src\/features\/(?![^/]+\/model\/(?:ids|[^/]+-search)\.ts$)/,
  // Dashboard form plumbing and app-level UI adapters.
  /\/apps\/app\/src\/(?:lib\/forms|components\/ui)\//,
  /\/apps\/app\/src\/lib\/mcp-oauth\.ts$/,
  // The signed-in shell's intent preload, which reads the dashboard's chunk lists.
  /\/apps\/app\/src\/lib\/dashboard-intent-preload\.ts$/,
  /\/packages\/shared\/src\/(?:mcp|rbac)\.ts$/,
];

/** Module ids (forward slashes) that a public profile must not contain. */
export const forbiddenModuleIds = (moduleIds) => moduleIds.filter((id) => forbiddenPublicModules.some((pattern) => pattern.test(id)));

// Rolldown groups shared modules by the set of chunks that import them. When
// marketing code imports a Lucide icon the reader also uses, the reader's icon
// chunks are re-partitioned and every docs page pays for the extra chunk
// boundaries, though no reader code changed (#332: +292 B gzip). Marketing uses
// its own copies (`components/marketing/site/marketing-icons.ts`) instead.
// The chunks are already partitioned around the reader icons marketing shared
// on main@88daac87 (mostly page-icon choices and the reader's own controls);
// a new one is what re-splits them. Add an icon to `KNOWN_MARKETING_READER_ICONS`
// (`reader-icons.ts`, which also groups those icons into one chunk) only with
// its measured public-docs cost.
const MARKETING_MODULE = /\/apps\/app\/src\/components\/(?:cloud-marketing\.tsx|marketing\/)/;
const LUCIDE_ICON = /\/node_modules\/lucide-react\/dist\/esm\/icons\/([\w-]+)\.mjs$/;

/** Reader icons that marketing code newly shares: Lucide icons in an
 *  icon-only chunk of a public profile (`publicFiles`) that a chunk holding
 *  marketing modules imports, statically or dynamically, minus the known ones.
 *  `chunks` are the module report's `{ fileName, imports, dynamicImports,
 *  modules: [{ id }] }` entries, with forward-slash ids. */
export function marketingSharedReaderIcons(chunks, publicFiles) {
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const shared = new Set();
  for (const chunk of chunks) {
    if (!chunk.modules.some((module) => MARKETING_MODULE.test(module.id))) continue;
    for (const file of [...(chunk.imports ?? []), ...(chunk.dynamicImports ?? [])]) {
      const target = byFile.get(file);
      if (!(target && publicFiles.has(file))) continue;
      const icons = target.modules.map((module) => LUCIDE_ICON.exec(module.id)?.[1]);
      // Mixed chunks (the router's entry, a component's) aren't icon groups.
      if (icons.length === 0 || icons.some((icon) => !icon)) continue;
      for (const icon of icons) if (!KNOWN_MARKETING_READER_ICONS.has(icon)) shared.add(icon);
    }
  }
  return [...shared].sort();
}

const ROUTE_MODULE = /\/apps\/app\/src\/routes\/(.+?)(?:\?.*)?$/;
const READER_ROUTE_FILE = /^(?:__root\.tsx|sites\/)/;

/** Rendered bytes of route modules other than the root and the reader's own
 * (`routes/sites/**`): what every published docs page pays for the rest of the
 * route tree. `modules` are `{ id, renderedLength }` entries from the report. */
export function nonReaderRouteBytes(modules) {
  let bytes = 0;
  let count = 0;
  for (const { id, renderedLength } of modules) {
    const file = ROUTE_MODULE.exec(id)?.[1];
    if (!file || READER_ROUTE_FILE.test(file)) continue;
    bytes += renderedLength;
    count += 1;
  }
  return { bytes, count };
}

// Dashboard-only code: the signed-in app's routes, and the components and data
// hooks only it uses. Sign-in, invitations and OAuth consent use some of the
// same data hooks, so a chunk is the dashboard's only when none of the other
// lazy imports of the chunk holding the preload table loads it.
const DASHBOARD_ONLY_MODULE =
  /\/apps\/app\/src\/(?:routes\/app\/|features\/|components\/(?:app|project|project-settings|settings|analytics|ai-conversations)\/|hooks\/api\/)/;
const DASHBOARD_ROUTE_MODULE = /\/apps\/app\/src\/routes\/app\//;

/** The files of a chunk's `__vite__mapDeps` preload table (`m.f=[…]`), or []. */
export function preloadTableFiles(source) {
  const table = /__vite__mapDeps=[\s\S]{0,120}?\.f=(\[[^\]]*\])/.exec(source)?.[1];
  return table ? JSON.parse(table) : [];
}

/** Dashboard chunks named in the preload table (`listed`) of chunk `owner`:
 *  chunks whose every module is dashboard-only code, and that none of
 *  `owner`'s lazy imports other than a dashboard route's loads, statically.
 *  `dashboardPreloadPlugin` keeps them out of the router's eager chunk, which
 *  published docs load. `chunks` are the module report's entries, with
 *  forward-slash ids. */
export function leakedDashboardPreloads(chunks, owner, listed) {
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const isDashboardRoute = (file) => DASHBOARD_ROUTE_MODULE.test(byFile.get(file)?.facadeModuleId?.replaceAll('\\', '/') ?? '');
  const needed = new Set();
  const queue = (byFile.get(owner)?.dynamicImports ?? []).filter((file) => !isDashboardRoute(file));
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (needed.has(file)) continue;
    needed.add(file);
    queue.push(...(byFile.get(file)?.imports ?? []));
  }
  return listed.filter((file) => {
    const modules = byFile.get(file)?.modules ?? [];
    return !needed.has(file) && modules.length > 0 && modules.every((module) => DASHBOARD_ONLY_MODULE.test(module.id));
  });
}
