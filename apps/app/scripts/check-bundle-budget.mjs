import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

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
  'dashboard-home': ['__root__', '/app', '/app/(dashboard)', '/app/(dashboard)/'],
  'dashboard-analytics': ['__root__', '/app', '/app/(dashboard)', '/app/(dashboard)/analytics'],
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
const gzipBudgets = {
  'public-docs': 365_000,
  'public-docs-index': 365_000,
};

// A size budget catches overall growth; these signatures make accidental
// provider-boundary regressions actionable even when another chunk shrinks.
const forbiddenPublicAssetPatterns = [/\/assets\/(?:app|auth-providers|localized-product-providers|queries|mutations|auth-client)-/];
const forbiddenPublicSourceTokens = ['settings.workspace.dangerDescription', 'editor.pageSettings.translationKey'];

// Marketing pages, the blog and their copy must never reach a published docs
// page. Route files are the usual leak: anything a route file exports, and its
// non-split options (head, loader, validateSearch), stay in the router's eager
// chunk, which every page loads. Checked against the module report that
// `BUNDLE_ANALYZE=true` builds write (CI always does); every profile includes
// the `__root__` route, so root preloads are covered too.
const forbiddenPublicModules = [
  /\/apps\/app\/src\/components\/(?:cloud-marketing\.tsx|marketing\/)/,
  /\/apps\/app\/src\/lib\/blog-manifest\.ts$/,
  /\/packages\/i18n\/src\/paraglide\/messages\/(?:marketing|blog)_/,
];

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
const moduleReport = existsSync(analysisFile)
  ? new Map(
      JSON.parse(readFileSync(analysisFile, 'utf8')).chunks.map((chunk) => [
        chunk.fileName,
        chunk.modules.map((module) => module.id.replaceAll('\\', '/')),
      ]),
    )
  : null;

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
  const publicAssets = Object.keys(gzipBudgets).flatMap((profile) => reports[profile]?.assets ?? []);
  const reportIsCurrent = moduleReport !== null && publicAssets.every((asset) => moduleReport.has(asset.url.replace(/^\//, '')));
  if (reportIsCurrent) {
    for (const profile of Object.keys(gzipBudgets)) {
      for (const asset of reports[profile]?.assets ?? []) {
        for (const moduleId of moduleReport.get(asset.url.replace(/^\//, ''))) {
          if (!forbiddenPublicModules.some((pattern) => pattern.test(moduleId))) continue;
          console.error(
            `\nBUNDLE BOUNDARY FAILED: ${profile} includes marketing module ${moduleId.replace(/^.*?\/(apps|packages)\//, '$1/')} in ${asset.url}.`,
          );
          invalid = true;
        }
      }
    }
  } else if (process.env.CI) {
    console.error('\nBUNDLE BOUNDARY FAILED: no module report for this build. Build with BUNDLE_ANALYZE=true before this check.');
    invalid = true;
  } else {
    console.warn('\nSkipped the marketing module check: build with BUNDLE_ANALYZE=true to run it.');
  }
}

if (invalid) process.exit(1);
