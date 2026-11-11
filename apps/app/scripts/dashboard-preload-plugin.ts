import type { Plugin } from 'vite';

/** A dashboard route's own source: everything under `src/routes/app/` (the signed-in app). */
const DASHBOARD_ROUTE_SOURCE = /\/apps\/app\/src\/routes\/app\//;

/** Where the client build writes the dashboard's route preload lists, read by
 *  `src/lib/dashboard-intent-preload.ts`. */
/**
 * The manifest changes with every build under a fixed name, so it lives at the
 * site root, outside `/assets/`: everything under `/assets/` is content-hashed
 * and served `immutable` for a year (and marked as static build output for the
 * custom-domain edge). vite.config.ts serves this file with a short, revalidated
 * cache instead.
 */
export const DASHBOARD_PRELOADS_FILE = 'dashboard-preloads.json';

/** How long a browser or proxy may reuse the manifest before checking it again. Never `immutable`. */
export const DASHBOARD_PRELOADS_CACHE_CONTROL = 'public, max-age=60, must-revalidate';

const ROUTE_FILE = /\/src\/routes\/([^?]+?)\.tsx?(?:\?.*)?$/;

/**
 * The TanStack route id of a route module (a source file under `src/routes/`,
 * possibly with a `?tsr-split=…` query), or `null` for anything else. File
 * routes: a trailing `route` segment is its directory's route, dots in a file
 * name separate path segments, and an `index` leaf is a trailing slash
 * (`app/projects/$projectId/analytics.index.tsx` →
 * `/app/projects/$projectId/analytics/`). Files starting with `-` aren't routes.
 */
export function routeIdFromModuleId(moduleId: string): string | null {
  const file = ROUTE_FILE.exec(moduleId.replaceAll('\\', '/'))?.[1];
  if (!file) return null;
  const directories = file.split('/');
  const name = directories.pop() ?? '';
  if (name.startsWith('-') || directories.some((directory) => directory.startsWith('-'))) return null;
  const segments = [...directories, ...name.split('.')];
  const leaf = segments.at(-1);
  if (leaf === 'route') segments.pop();
  else if (leaf === 'index') segments[segments.length - 1] = '';
  return `/${segments.join('/')}`;
}

/** `start` and every chunk it statically imports, directly or not. */
export function transitiveImports(start: string, importsOf: (fileName: string) => readonly string[] | undefined): Set<string> {
  const seen = new Set<string>();
  const queue = [start];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    queue.push(...(importsOf(file) ?? []));
  }
  return seen;
}

interface ManifestChunk {
  fileName: string;
  facadeModuleId: string | null;
  imports: readonly string[];
  isEntry: boolean;
}

/**
 * For each dashboard route, the chunks its split parts (component, loader,
 * error and not-found components) load: each chunk and its static imports,
 * unioned per route. Chunks the entry already loads statically are left out,
 * since every page has them. URLs are as served (`/assets/…`), sorted.
 */
export function buildDashboardPreloads(chunks: readonly ManifestChunk[]): Record<string, string[]> {
  const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
  const importsOf = (file: string) => byFile.get(file)?.imports;
  const alwaysLoaded = new Set(chunks.filter((chunk) => chunk.isEntry).flatMap((chunk) => [...transitiveImports(chunk.fileName, importsOf)]));
  const preloads = new Map<string, Set<string>>();
  for (const chunk of chunks) {
    const facade = chunk.facadeModuleId?.replaceAll('\\', '/');
    if (!(facade && DASHBOARD_ROUTE_SOURCE.test(facade))) continue;
    const routeId = routeIdFromModuleId(facade);
    if (!routeId) continue;
    const files = preloads.get(routeId) ?? new Set<string>();
    for (const file of transitiveImports(chunk.fileName, importsOf)) if (!alwaysLoaded.has(file)) files.add(file);
    preloads.set(routeId, files);
  }
  return Object.fromEntries(
    [...preloads].sort(([a], [b]) => a.localeCompare(b)).map(([routeId, files]) => [routeId, [...files].sort().map((file) => `/${file}`)]),
  );
}

/**
 * Keeps the dashboard's lazy-route preload lists out of the router's eager chunk.
 *
 * Vite writes, for every dynamic import, the list of chunks to preload with it
 * into a `__vite__mapDeps` table in the importing chunk. Every route's lazy
 * import lives in the router's eager chunk, which each published docs page
 * loads, so every dashboard chunk name used to ship to readers, and any new
 * shared dashboard component grew their first load (#388: +98 B for one name).
 *
 * This plugin records which output chunks are dashboard routes (their facade
 * module is a dashboard route file); `resolveDependencies` then gives those
 * dynamic imports no preload list. A dashboard route chunk still loads its
 * dependencies through its own static imports. So that they don't load level by
 * level after a click, the client build also writes each dashboard route's
 * full chunk list to `dashboard-preloads.json`, which the signed-in shell
 * reads to preload a link's chunks on hover or focus
 * (`src/lib/dashboard-intent-preload.ts`).
 */
export function dashboardPreloadPlugin() {
  const dashboardChunks = new Set<string>();
  const plugin: Plugin = {
    name: 'nibleaf-dashboard-preload',
    apply: 'build',
    // Runs before Vite's own import analysis (a post plugin), which asks
    // `resolveDependencies` while it writes the preload table.
    generateBundle(outputOptions, bundle) {
      dashboardChunks.clear();
      const chunks: ManifestChunk[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue;
        chunks.push(item);
        if (item.facadeModuleId && DASHBOARD_ROUTE_SOURCE.test(item.facadeModuleId.replaceAll('\\', '/'))) {
          dashboardChunks.add(item.fileName);
        }
      }
      if (!outputOptions.dir?.replaceAll('\\', '/').endsWith('/.output/public')) return;
      this.emitFile({ type: 'asset', fileName: DASHBOARD_PRELOADS_FILE, source: JSON.stringify(buildDashboardPreloads(chunks)) });
    },
  };
  /** `build.modulePreload.resolveDependencies`: no preload list for a dashboard route chunk. */
  const resolveDependencies = (filename: string, deps: string[]) => (dashboardChunks.has(filename) ? [] : deps);
  return { plugin, resolveDependencies };
}
