import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  forbiddenModuleIds,
  leakedDashboardPreloads,
  marketingSharedReaderIcons,
  nonReaderRouteBytes,
  preloadTableFiles,
} from './bundle-boundaries.mjs';

const appRoot = resolve(import.meta.dirname, '..');
const publicRoot = join(appRoot, '.output', 'public');
const serverRoot = join(appRoot, '.output', 'server');

// A profile is the exact route ancestry hydrated for a representative direct
// navigation. TanStack Start's generated manifest already expands each route's
// preload list to its dependent chunks, so summing the unique JavaScript assets
// mirrors what the browser is instructed to fetch without double-counting.
const profiles = {
  'public-docs': ['__root__', '/sites/$projectId', '/sites/$projectId/$'],
  'public-docs-index': ['__root__', '/sites/$projectId', '/sites/$projectId/'],
  // The dashboard home is an organization's Websites page (/app lands there).
  'dashboard-home': ['__root__', '/app', '/app/o/$orgSlug', '/app/o/$orgSlug/websites'],
  'dashboard-analytics': ['__root__', '/app', '/app/o/$orgSlug', '/app/o/$orgSlug/analytics'],
  // The first step of the first-run journey (and where /app sends a signed-out visitor).
  'auth-sign-in': ['__root__', '/(auth)', '/(auth)/sign-in'],
  'auth-sign-up': ['__root__', '/(auth)', '/(auth)/sign-up'],
};

// These values are intentionally applied to gzip transfer size, not raw file
// size. Keep enough headroom for normal feature work while preventing a large
// shared dependency or dashboard catalog from silently returning to docs pages.
//
// 393_000 → 365_000 (#291): marketing pages and their copy no longer reach the
// reader, about 31 KiB less. Two route files exported their page components and
// Arabic marketing heads read their copy through the reader's translator, which
// kept them in the router's eager chunk; the boundary checks below now fail on
// that. The margin is ~4 KiB over the measured size. See BUNDLE_BUDGET.md.
// 365_000 → 356_000 (#291): dashboard loaders load with their routes, and the
// settings and auth routes' search checks no longer pull in icons or MCP code.
// 356_000 → 349_700 (#345): marketing routes build their head in the loader
// from a lazy import, and every non-reader route's loader loads with its route,
// about 7.1 KiB less. The margin is ~2 KiB over the 347,620 bytes measured
// after #336's use-case routes.
// 349_700 → 348_200 (#345): marketing pages moved to their own route table,
// dispatched by nine thin router routes, about 2.3 KiB less. The margin is ~2 KiB
// over the 346,122 bytes measured.
// 348_200 → 345_100 (#393): dashboard routes no longer list their dependency
// chunks in the router's eager preload table; the dashboard preloads them on
// intent from its own manifest instead. About 2.8 KiB less; the margin is ~2 KiB
// over the 343,096 bytes measured.
// auth-sign-in / auth-sign-up (MKT-001): 1,210 KiB before, when every product
// message in every locale shipped with the sign-in form (translateFn's catalog
// import). The auth pages translate through @nibleaf/i18n/scoped now; measured
// 398,182 and 399,872 bytes, with ~2 KiB of margin.
const gzipBudgets = {
  'public-docs': 345_100,
  'public-docs-index': 345_100,
  'auth-sign-in': 402_000,
  // 402,000 → 403,000: #674 (Arabic pricing) and #613 (accent contrast helpers in the shared themes chunk) together took sign-up to 402,212.
  'auth-sign-up': 403_000,
};

/** The published-docs profiles: the dashboard, auth and marketing boundaries
 *  below apply to these. The auth profiles only have a size budget (they are
 *  product pages and legitimately load the auth client and providers). */
const publicProfiles = ['public-docs', 'public-docs-index'];

// A size budget catches overall growth; these signatures make accidental
// provider-boundary regressions actionable even when another chunk shrinks.
const forbiddenPublicAssetPatterns = [/\/assets\/(?:app|auth-providers|localized-product-providers|queries|mutations|auth-client)-/];
const forbiddenPublicSourceTokens = ['settings.workspace.dangerDescription', 'editor.pageSettings.translationKey'];

// Forbidden modules (marketing, blog, dashboard data code) live in
// `bundle-boundaries.mjs`, checked against the module report that
// `BUNDLE_ANALYZE=true` builds write (CI always does).

// The same boundary without the module report: marketing and blog copy from the
// English and Arabic catalogs must not appear in public assets. Read from the
// catalogs so it follows copy edits; values with quotes, escapes or {variables}
// aren't matched verbatim in minified output, so they're skipped.
const catalogRoot = resolve(appRoot, '../../packages/i18n/messages');
const forbiddenPublicCopy = ['en.json', 'ar.json'].flatMap((file) =>
  Object.entries(JSON.parse(readFileSync(join(catalogRoot, file), 'utf8')))
    .filter(([key, value]) => /^(?:marketing|blog)_/.test(key) && typeof value === 'string' && value.length >= 32 && !/["`\\{}$\n]/.test(value))
    .map(([key, value]) => ({ key, value })),
);
if (forbiddenPublicCopy.length < 50) {
  console.error(`Only ${forbiddenPublicCopy.length} marketing/blog catalog strings found; the catalog layout changed, so update this check.`);
  process.exit(2);
}

const analysisFile = join(appRoot, '.bundle-analysis', 'client-modules.json');
const chunkReport = existsSync(analysisFile)
  ? JSON.parse(readFileSync(analysisFile, 'utf8')).chunks.map((chunk) => ({
      ...chunk,
      modules: chunk.modules.map((module) => ({ id: module.id.replaceAll('\\', '/'), renderedLength: module.renderedLength })),
    }))
  : null;
const moduleReport = chunkReport ? new Map(chunkReport.map((chunk) => [chunk.fileName, chunk.modules])) : null;

const formatBytes = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;

const manifestFile = existsSync(serverRoot)
  ? readdirSync(serverRoot).find((name) => name.startsWith('_tanstack-start-manifest_') && name.endsWith('.mjs'))
  : undefined;

let manifestFactory;
if (manifestFile) {
  const manifestModule = await import(`${pathToFileURL(join(serverRoot, manifestFile)).href}?t=${Date.now()}`);
  manifestFactory = manifestModule.tsrStartManifest;
} else {
  // Runtime-safe SSR builds keep TanStack's service namespace in one chunk.
  // Read the generated literal from that chunk so bundle budgets remain
  // enforceable without reintroducing the circular SSR chunk split.
  const ssrRoot = join(serverRoot, '_ssr');
  const marker = 'tsrStartManifest = () => (';
  const ssrSource = existsSync(ssrRoot)
    ? readdirSync(ssrRoot)
        .filter((name) => name.endsWith('.mjs'))
        .map((name) => readFileSync(join(ssrRoot, name), 'utf8'))
        .find((source) => source.includes(marker))
    : undefined;
  const start = ssrSource?.indexOf(marker);
  const end = start === undefined || start < 0 ? -1 : ssrSource.indexOf('\n}));', start + marker.length);
  if (ssrSource && start !== undefined && start >= 0 && end >= 0) {
    const manifestLiteral = ssrSource
      .slice(start + marker.length, end)
      .trimEnd()
      .replace(/\);$/, '');
    const manifestJson = manifestLiteral
      .replace(/([{,]\s*)([$A-Z_a-z][$\w]*):/g, '$1"$2":')
      .replace(/\bvoid 0\b/g, 'null')
      .replace(/!0/g, 'true')
      .replace(/!1/g, 'false');
    manifestFactory = () => JSON.parse(manifestJson);
  }
}

if (typeof manifestFactory !== 'function') {
  console.error('Bundle manifest not found. Run `pnpm --filter @nibleaf/app build` before this check.');
  process.exit(2);
}

const routes = manifestFactory().routes;
const reports = {};
let invalid = false;

for (const [profile, routeIds] of Object.entries(profiles)) {
  const urls = new Set();
  for (const routeId of routeIds) {
    const route = routes[routeId];
    if (!route) {
      console.error(`[${profile}] route ${routeId} is missing from the generated manifest.`);
      invalid = true;
      continue;
    }
    for (const preload of route.preloads ?? []) {
      if (preload.endsWith('.js')) urls.add(preload);
    }
    for (const script of route.scripts ?? []) {
      const source = script.attrs?.src;
      if (typeof source === 'string' && source.endsWith('.js')) urls.add(source);
    }
  }

  const assets = [...urls]
    .map((url) => {
      const file = join(publicRoot, url.replace(/^\//, ''));
      if (!existsSync(file)) {
        console.error(`[${profile}] manifest asset is missing: ${url}`);
        invalid = true;
        return null;
      }
      const contents = readFileSync(file);
      return { url, raw: contents.byteLength, gzip: gzipSync(contents, { level: 9 }).byteLength };
    })
    .filter(Boolean)
    .sort((a, b) => b.gzip - a.gzip);

  reports[profile] = {
    raw: assets.reduce((sum, asset) => sum + asset.raw, 0),
    gzip: assets.reduce((sum, asset) => sum + asset.gzip, 0),
    assets,
  };
}

console.log('JavaScript bundle report (unique route preloads, gzip level 9)');
for (const [profile, report] of Object.entries(reports)) {
  const budget = gzipBudgets[profile];
  console.log(`\n${profile}: ${formatBytes(report.raw)} raw / ${formatBytes(report.gzip)} gzip${budget ? ` (budget ${formatBytes(budget)})` : ''}`);
  for (const asset of report.assets.slice(0, 8)) {
    console.log(`  ${formatBytes(asset.gzip).padStart(11)} gzip  ${formatBytes(asset.raw).padStart(11)} raw  ${asset.url}`);
  }
  if (budget && moduleReport) {
    // Every route's definition ships in the router's eager chunk (#345). This is
    // what the routes a docs reader never visits add to each published page.
    const modules = new Map(
      report.assets.flatMap((asset) => moduleReport.get(asset.url.replace(/^\//, '')) ?? []).map((module) => [module.id, module]),
    );
    const routes = nonReaderRouteBytes([...modules.values()]);
    console.log(`  non-reader route modules: ${routes.count}, ${formatBytes(routes.bytes)} rendered`);
  }
}

const shared = Object.values(reports)
  .flatMap((report) => report.assets.map((asset) => asset.url))
  .filter((url, index, all) => all.indexOf(url) === index && all.filter((candidate) => candidate === url).length === Object.keys(reports).length);
if (shared.length > 0) console.log(`\nShared by every profile: ${shared.join(', ')}`);

if (process.argv.includes('--check')) {
  for (const [profile, budget] of Object.entries(gzipBudgets)) {
    const actual = reports[profile]?.gzip;
    if (actual === undefined || actual > budget) {
      const over = actual === undefined ? 'missing' : `${formatBytes(actual - budget)} over`;
      console.error(`\nBUNDLE BUDGET FAILED: ${profile} is ${over} its ${formatBytes(budget)} gzip budget.`);
      console.error(
        'Largest assets are printed above; inspect the generated route manifest and run with BUNDLE_ANALYZE=true for module attribution.',
      );
      invalid = true;
    }
  }

  for (const profile of publicProfiles) {
    const forbiddenAssets = reports[profile]?.assets.filter((asset) => forbiddenPublicAssetPatterns.some((pattern) => pattern.test(asset.url)));
    if (forbiddenAssets?.length) {
      console.error(`\nBUNDLE BOUNDARY FAILED: ${profile} includes dashboard/auth assets:`);
      for (const asset of forbiddenAssets) console.error(`  ${asset.url}`);
      invalid = true;
    }

    for (const asset of reports[profile]?.assets ?? []) {
      const source = readFileSync(join(publicRoot, asset.url.replace(/^\//, '')), 'utf8');
      const token = forbiddenPublicSourceTokens.find((candidate) => source.includes(candidate));
      if (token) {
        console.error(`\nBUNDLE BOUNDARY FAILED: ${profile} includes dashboard catalog token ${JSON.stringify(token)} in ${asset.url}.`);
        invalid = true;
      }
      const copy = forbiddenPublicCopy.find((candidate) => source.includes(candidate.value));
      if (copy) {
        console.error(`\nBUNDLE BOUNDARY FAILED: ${profile} includes marketing copy (${copy.key}) in ${asset.url}.`);
        invalid = true;
      }
    }
  }

  // A report from an older build would vouch for chunks it never saw.
  const publicAssets = publicProfiles.flatMap((profile) => reports[profile]?.assets ?? []);
  const reportIsCurrent = moduleReport !== null && publicAssets.every((asset) => moduleReport.has(asset.url.replace(/^\//, '')));
  if (reportIsCurrent) {
    for (const profile of publicProfiles) {
      for (const asset of reports[profile]?.assets ?? []) {
        const moduleIds = moduleReport.get(asset.url.replace(/^\//, '')).map((module) => module.id);
        for (const moduleId of forbiddenModuleIds(moduleIds)) {
          console.error(
            `\nBUNDLE BOUNDARY FAILED: ${profile} includes forbidden module ${moduleId.replace(/^.*?\/(apps|packages)\//, '$1/')} in ${asset.url}.`,
          );
          invalid = true;
        }
      }
    }
    const publicFiles = new Set(publicAssets.map((asset) => asset.url.replace(/^\//, '')));
    // The router's eager chunk names, in its preload table, every chunk each
    // lazy import loads. Dashboard routes get no list there (#393), so their
    // chunk names stay out of published docs; see BUNDLE_BUDGET.md.
    for (const file of publicFiles) {
      const listed = preloadTableFiles(readFileSync(join(publicRoot, file), 'utf8'));
      const leaked = leakedDashboardPreloads(chunkReport, file, listed);
      if (leaked.length === 0) continue;
      console.error(
        `\nBUNDLE BOUNDARY FAILED: dashboard chunk names leak into the published-docs eager preload list (${file}, ${leaked.length} of ${listed.length}):`,
      );
      for (const leak of leaked.slice(0, 10)) console.error(`  ${leak}`);
      if (leaked.length > 10) console.error(`  … and ${leaked.length - 10} more`);
      console.error('  Check that dashboardPreloadPlugin (scripts/dashboard-preload-plugin.ts) is wired into vite.config.ts.');
      invalid = true;
    }
    for (const icon of marketingSharedReaderIcons(chunkReport, publicFiles)) {
      console.error(
        `\nBUNDLE BOUNDARY FAILED: marketing code imports the reader's ${icon} icon, which re-splits the reader's icon chunks. Use a copy in components/marketing/site/marketing-icons.ts.`,
      );
      invalid = true;
    }
  } else if (process.env.CI) {
    console.error('\nBUNDLE BOUNDARY FAILED: no module report for this build. Build with BUNDLE_ANALYZE=true before this check.');
    invalid = true;
  } else {
    console.warn('\nSkipped the module boundary check: build with BUNDLE_ANALYZE=true to run it.');
  }
}

if (invalid) process.exit(1);
