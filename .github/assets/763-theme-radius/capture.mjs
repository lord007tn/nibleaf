// Synthetic Theme form, real controls/hooks and resolver, intercepted fictional API.
// Set NIBLEAF_DEVSTACK_LOCK to the owner's canonical directory before running:
// node .github/assets/763-theme-radius/capture.mjs [--before-only]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { freemem } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';

const fixture = `// Actual Theme form and query/mutation hooks; capture.mjs supplies a fictional API.
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ThemeSettings } from '@/features/site-theme/components/theme-settings';
import { projectQueryOptions } from '@/hooks/api/query-options';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
document.documentElement.lang = locale;
document.documentElement.classList.toggle('dark', params.get('mode') === 'dark');
document.documentElement.style.colorScheme = params.get('mode') === 'dark' ? 'dark' : 'light';

function Fixture() {
  const { data } = useQuery(projectQueryOptions('site-763'));
  return (
    <ConfirmProvider>
      <main className="mx-auto max-w-5xl bg-background p-4 text-foreground sm:p-6">{data ? <ThemeSettings project={data} /> : null}</main>
    </ConfirmProvider>
  );
}

const element = document.getElementById('root');
if (!element) throw new Error('Missing fixture root');
createRoot(element).render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <Fixture />
  </QueryClientProvider>,
);
`;

const root = resolve(import.meta.dirname, '../../..');
const appDir = resolve(root, 'apps/app');
const output = resolve(root, '.github/assets/763-theme-radius');
const baseline = process.env.BASELINE ?? '081299f4d304c42a96a655acb308e4d4dc2f93a4';
const component = 'apps/app/src/features/site-theme/components/theme-settings.tsx';
const before = execFileSync('git', ['show', `${baseline}:${component}`], { cwd: root, encoding: 'utf8' });
const appRequire = createRequire(resolve(appDir, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const lockPath = process.env.NIBLEAF_DEVSTACK_LOCK;
assert.ok(lockPath, 'Set NIBLEAF_DEVSTACK_LOCK to the canonical devstack directory');
const owner = `ui/763-builder\npid=${process.pid}\nstarted=${new Date().toISOString()}\n`;
const origin = 'http://127.0.0.1:4310';
const phases = process.argv.includes('--before-only') ? ['before'] : ['before', 'after'];
const ram = () => assert.ok(freemem() >= 5 * 1024 ** 3, 'Capture requires at least 5 GiB free RAM');
ram();
await new Promise((accept, reject) => {
  const socket = createConnection({ host: '127.0.0.1', port: 4310 });
  socket.once('connect', () => {
    socket.destroy();
    reject(new Error('Port 4310 is already listening'));
  });
  socket.once('error', (error) => (error.code === 'ECONNREFUSED' ? accept() : reject(error)));
});
await mkdir(lockPath); // Atomic; a foreign lock is never borrowed or deleted.
let harness;
try {
  await writeFile(resolve(lockPath, 'owner.txt'), owner);
  harness = await mkdtemp(resolve(appDir, '.theme-radius-'));
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Theme radius fixture</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'main.tsx'), `import './styles.css';\n${fixture}`);
  await writeFile(resolve(harness, 'styles.css'), '@import "../src/styles.css";\n@source "../src";\n@source "./main.tsx";\n');
  const { build, preview } = await fromApp('vite');
  const arabicCatalog = JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8'));
  const evidence = [];
  for (const phase of phases) {
    ram();
    const outDir = resolve(harness, phase);
    await build({
      configFile: false,
      envDir: false,
      root: harness,
      logLevel: 'error',
      resolve: { alias: { '@': resolve(appDir, 'src') } },
      plugins: [
        (await fromApp('@vitejs/plugin-react')).default(),
        (await fromApp('@tailwindcss/vite')).default(),
        {
          name: 'theme-radius-fixture',
          enforce: 'pre',
          resolveId(source) {
            // This checkout's browser RPC source; no server build or borrowed dist.
            if (source === '@nibleaf/server/rpc') return resolve(root, 'apps/server/src/rpc.ts');
            if (source.startsWith('@nibleaf/')) return appRequire.resolve(source);
          },
          load(file) {
            const path = file.replaceAll('\\', '/');
            if (path.endsWith('/src/services/api-origin.ts')) return 'export const apiOrigin = () => window.location.origin;';
            if (path.endsWith('/src/lib/site-origin.ts')) return 'export const customDomainOrigin = () => undefined;';
            if (path.endsWith('/src/functions/site-search.ts'))
              return 'export const searchSiteFn = () => { throw new Error("Outside radius fixture"); };';
            if (phase === 'before' && path.endsWith(`/${component}`)) return before;
          },
        },
      ],
      build: { outDir, emptyOutDir: true, target: 'esnext' },
    });
    const server = await preview({
      configFile: false,
      envDir: false,
      root: harness,
      build: { outDir },
      preview: { host: '127.0.0.1', port: 4310, strictPort: true },
    });
    try {
      await withLocalOnlyBrowser({ allowedHosts: ['127.0.0.1:4310'], launch: { headless: true } }, async ({ browser, attempted }) => {
        for (const locale of ['en', 'ar'])
          for (const width of [390, 1440])
            for (const mode of ['light', 'dark']) {
              ram();
              const recording = phase === 'after' && locale === 'en' && width === 1440 && mode === 'light';
              const context = await browser.newContext({
                viewport: { width, height: width === 390 ? 844 : 1000 },
                reducedMotion: 'reduce',
                recordVideo: recording ? { dir: output, size: { width: 1440, height: 1000 } } : undefined,
              });
              try {
                const page = await context.newPage();
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                const catalog = JSON.parse(await readFile(resolve(root, `packages/i18n/messages/${locale}.json`), 'utf8'));
                const project = {
                  id: 'site-763',
                  organizationId: 'org',
                  name: 'Handbook',
                  slug: 'handbook',
                  config: { theme: { version: 1, preset: 'signal' }, styling: { radius: 'pill', theme: mode } },
                };
                const patches = [];
                await page.route(`${origin}/api/**`, async (route) => {
                  assert.equal(new URL(route.request().url()).pathname, '/api/app/projects/site-763');
                  if (route.request().method() === 'PATCH') {
                    const { config } = route.request().postDataJSON();
                    patches.push(config);
                    assert.deepEqual(Object.keys(config), ['theme']);
                    project.config.theme = { ...project.config.theme, ...config.theme };
                  } else assert.equal(route.request().method(), 'GET');
                  await route.fulfill({ json: { data: project } });
                });
                await page.goto(`${origin}/?locale=${locale}&mode=${mode}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
                const radius = page.getByRole('combobox', { name: catalog.settings_styling_radius_label, exact: true });
                const shownRadius = () => radius.locator('[data-slot="select-value"]').textContent();
                await radius.waitFor();
                if (locale === 'ar') await page.getByRole('button', { name: arabicCatalog.settings_theme_preview_switcharabic, exact: true }).click();
                await radius.scrollIntoViewIfNeeded();
                await page.evaluate(() => window.scrollBy(0, -120));
                assert.equal(await shownRadius(), phase === 'before' ? catalog.settings_theme_option_pill : catalog.settings_theme_option_sharp);
                const reader = page.locator('[data-theme-context="studio-preview"]');
                assert.equal(await reader.getAttribute('data-theme-radius'), 'pill');
                assert.equal(await reader.getAttribute('dir'), locale === 'ar' ? 'rtl' : 'ltr');
                assert.equal(await reader.evaluate((element) => element.classList.contains('dark')), mode === 'dark');
                assert.deepEqual(patches, []);
                if (phase === 'after') {
                  assert.ok((await page.locator('[data-radius-override]').textContent()).includes(catalog.settings_styling_radius_override));
                }
                await radius.click();
                await page.getByRole('option', { name: catalog.settings_theme_option_rounded, exact: true }).click();
                const expected = phase === 'before' ? catalog.settings_theme_option_pill : catalog.settings_theme_option_rounded;
                assert.equal(await shownRadius(), expected);
                assert.equal(await reader.getAttribute('data-theme-radius'), 'pill');
                await page.getByRole('button', { name: catalog.common_save, exact: true }).click();
                await page.getByText(catalog.common_saved, { exact: true }).waitFor();
                assert.deepEqual(patches, [{ theme: { version: 1, preset: 'signal', layout: { radius: 'rounded' } } }]);
                await page.reload();
                await radius.waitFor();
                if (locale === 'ar') await page.getByRole('button', { name: arabicCatalog.settings_theme_preview_switcharabic, exact: true }).click();
                assert.equal(await shownRadius(), expected);
                assert.equal(await reader.getAttribute('data-theme-radius'), 'pill');
                await radius.scrollIntoViewIfNeeded();
                await page.evaluate(() => window.scrollBy(0, -120));
                await page.screenshot({ path: resolve(output, `${phase}-${locale}-${width}-${mode}.png`) });
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
                assert.deepEqual(errors, []);
                evidence.push({
                  phase,
                  locale,
                  width,
                  mode,
                  themeRadius: project.config.theme.layout.radius,
                  select: await shownRadius(),
                  reader: await reader.getAttribute('data-theme-radius'),
                  patches,
                  errors,
                });
                if (recording) {
                  const video = page.video();
                  await context.close();
                  await rename(await video.path(), resolve(output, 'interaction.webm'));
                }
              } finally {
                await context.close();
              }
            }
        assert.equal(attempted.length, 0);
        console.log(`${phase}: non-local attempts ${attempted.length}`);
      });
    } finally {
      await new Promise((accept, reject) => server.httpServer.close((error) => (error ? reject(error) : accept())));
    }
  }
  await writeFile(
    resolve(output, phases.length === 1 ? 'baseline.json' : 'results.json'),
    `${JSON.stringify({ baseline, synthetic: true, evidence }, null, 2)}\n`,
  );
} finally {
  if (harness) {
    assert.equal(resolve(harness, '..'), appDir, 'Refusing to remove a harness outside this checkout');
    await rm(harness, { recursive: true, force: true });
  }
  assert.equal(await readFile(resolve(lockPath, 'owner.txt'), 'utf8'), owner, 'Refusing to release a foreign devstack lock');
  await rm(lockPath, { recursive: true });
}
