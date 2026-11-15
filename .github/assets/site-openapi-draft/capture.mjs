// Isolated specimens of Site settings → OpenAPI: the real section (before: the
// main-branch component; after: features/site-openapi) on a real TanStack Query
// cache seeded with a fixture configuration. A "refetch" is the cache receiving
// new server data, exactly what the section's query subscription sees. These
// are not signed-in dashboard or production captures. No server is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
const beforeSource = git('show', `${baseline}:apps/app/src/components/project-settings/openapi-section.tsx`).replace(
  "from './shared'",
  "from '@/components/project-settings/shared'",
);
const origin = 'http://openapi.fixture.test';
const lock = await acquireDevstackLock('site OpenAPI draft captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.openapi-capture-'));
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-openapi";\n@source "../src/components/project-settings";\n@source "../src/components/query-error-state.tsx";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { OpenApiSettings } from '@/features/site-openapi/components/openapi-settings';
import { queryKeys } from '@/hooks/api/query-keys';
import { OpenApiSection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const key = queryKeys.openapi.detail('site-1');
const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false } } });
client.setQueryData(key, {
  title: 'Payments API',
  path: 'payments',
  contentHash: 'hash-1',
  updatedAt: '2026-11-01T10:00:00.000Z',
  source: { type: 'url', url: 'https://api.example.com/openapi.yaml' },
});
// What a refetch delivers: the server's configuration, changed elsewhere.
Object.assign(window, { serverChange: (patch: object) => client.setQueryData(key, (old: object) => ({ ...old, ...patch })) });
const Section = params.get('phase') === 'before' ? BeforeSection : OpenApiSettings;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <main className="mx-auto w-full max-w-3xl p-4 text-foreground sm:p-8"><Section projectId="site-1" /></main>
    </ConfirmProvider>
  </QueryClientProvider>,
);
`,
  );
  const { build } = await fromApp('vite');
  await build({
    configFile: false,
    root: harness,
    logLevel: 'error',
    resolve: { alias: [{ find: /^@\//, replacement: `${resolve(app, 'src')}/` }] },
    plugins: [
      // Without TanStack Start's plugin, the isomorphic API origin keeps its
      // server branch (and the server env); the browser only ever takes the client one.
      {
        name: 'client-api-origin',
        enforce: 'pre',
        resolveId: (source, importer) =>
          source === './api-origin' && importer?.replaceAll('\\', '/').endsWith('/src/services/api.ts') ? '\0client-api-origin' : undefined,
        load: (id) => (id === '\0client-api-origin' ? 'export const apiOrigin = () => window.location.origin;' : undefined),
      },
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  // Each scene: which component, what the person does, and what the server changes meanwhile.
  const scenes = [
    { name: 'summary', phase: 'after' },
    { name: 'refetch', phase: 'before', title: 'Billing API', change: { path: 'payments-v2', contentHash: 'hash-2' } },
    { name: 'refetch', phase: 'after', title: 'Billing API', change: { path: 'payments-v2', contentHash: 'hash-2' } },
    { name: 'conflict', phase: 'after', title: 'Billing API', change: { title: 'Payments API v2', contentHash: 'hash-2' } },
  ];
  const captures = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390])
        for (const scene of scenes) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          page.on('pageerror', (error) => console.error(error.stack));
          const consoleErrors = [];
          page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));
          await page.route(`${origin}/**`, async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
            assert.ok(file.startsWith(`${dist}${sep}`));
            const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
            await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
          });
          await page.goto(`${origin}/?locale=${locale}&phase=${scene.phase}`);
          await page
            .locator('[data-slot="alert"]')
            .first()
            .waitFor({ timeout: 15_000 })
            .catch((error) => {
              throw new Error(`${error.message}
Page errors: ${JSON.stringify(errors)}
Console errors: ${JSON.stringify(consoleErrors)}`);
            });
          let titleAfterRefetch;
          if (scene.title) {
            await page.locator('[data-slot="alert"] button').first().click();
            await page.locator('#openapi-title').fill(scene.title);
            await page.evaluate((change) => window.serverChange(change), scene.change);
            await page.waitForTimeout(50);
            titleAfterRefetch = await page.locator('#openapi-title').inputValue();
          }
          await page.evaluate(() => document.fonts.ready);
          const dir = await page.evaluate(() => document.documentElement.dir);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
          assert.equal(dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(overflow, false);
          assert.deepEqual(errors, []);
          if (scene.title) assert.equal(titleAfterRefetch, scene.phase === 'before' ? 'Payments API' : scene.title);
          const file = `${scene.name}-${scene.phase}-${locale}-${width}.png`;
          await page.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, animations: 'disabled' });
          captures.push({
            file,
            scene: scene.name,
            phase: scene.phase,
            locale,
            width,
            dir,
            typedTitle: scene.title,
            titleAfterRefetch,
            errors,
            overflow,
          });
          await context.close();
        }
    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Isolated section specimens: real OpenAPI section components on a seeded TanStack Query cache; not the full dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      attempted: attempted.length,
      captures,
    });
  });
  console.log(`${captures.length} OpenAPI captures; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
