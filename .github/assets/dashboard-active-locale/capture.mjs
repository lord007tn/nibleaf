// Build the fictional comparison fixture under the heavy lock:
//   node .github/assets/dashboard-active-locale/capture.mjs build
// Then, outside that slot, capture under the canonical devstack directory lock:
//   node .github/assets/dashboard-active-locale/capture.mjs capture
// BASELINE names the measured base commit. No database or account is used;
// private-preview SSR uses the built app with a fictional read-only local API.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { freemem, tmpdir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { checkDevGeneration } from './dev-generation.mjs';
import { withPrivatePreviewRuntime } from './preview-runtime.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = join(root, 'apps/app');
const scratch = join(root, '.tmp/dashboard-active-locale');
const output = import.meta.dirname;
const baseline = process.env.BASELINE;
assert.ok(baseline, 'Set BASELINE to the pinned measured base SHA');
assert.match(baseline, /^[0-9a-f]{40}$/, 'BASELINE must be a full pinned commit SHA');
const appRequire = createRequire(join(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const origin = 'http://localhost:4310';
async function releaseOwnedDevstack(lock, owner) {
  const readback = await readFile(join(lock.path, 'owner.txt'), 'utf8');
  if (!readback.startsWith(`${owner}\n`)) {
    lock.keep();
    throw new Error('Devstack lock owner changed; preserved');
  }
  await lock.release();
}
const mode = process.argv[2];
assert.ok(['build', 'capture'].includes(mode), 'Use build or capture');
assert.ok(freemem() >= 5 * 1024 ** 3, 'At least 5 GiB free RAM required');

if (mode === 'build') {
  assert.ok(process.env.NIBLEAF_HEAVY_OWNER, 'Set your exact acquired heavy-lock owner prefix');
  const owner = await readFile(join(tmpdir(), 'nibleaf-heavy.lock'), 'utf8');
  assert.ok(owner.startsWith(`${process.env.NIBLEAF_HEAVY_OWNER} `), 'Must own the heavy lock');
  const { build, defaultClientConditions } = await fromApp('vite');
  const baselineSources = Object.fromEntries(
    ['packages/i18n/src/runtime.ts', 'packages/i18n/src/translate.ts'].map((file) => [
      file,
      execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' }),
    ]),
  );
  for (const phase of ['before', 'after']) {
    assert.ok(freemem() >= 5 * 1024 ** 3, 'At least 5 GiB free RAM before each build');
    const harness = join(scratch, phase);
    await mkdir(harness, { recursive: true });
    await writeFile(
      join(harness, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Locale fixture</title></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
    );
    await writeFile(
      join(harness, 'styles.css'),
      `@import "${relative(harness, join(app, 'src/styles.css')).replaceAll('\\', '/')}";\n@source "${relative(harness, join(app, 'src')).replaceAll('\\', '/')}";\n@source "./main.tsx";\n`,
    );
    await writeFile(
      join(harness, 'main.tsx'),
      `
import './styles.css';
import { ThemeProvider } from '@nibleaf/design-system/theme';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import { useLocale } from '@nibleaf/i18n/react';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { createRootRoute, createRoute, createRouter, createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OrgSidebar } from '@/components/app/org-sidebar';
import { PageHeader } from '@/components/app/page-header';
import { InterfaceLanguageDialog } from '@/components/interface-language-dialog';
import { reloadOnceOnChunkLoadFailure } from '@/lib/chunk-reload';
${phase === 'after' ? "import { configureDashboardLocaleLoading, prepareDashboardLocale } from '@nibleaf/i18n/dashboard-catalog';\nimport { runOptionalLoad } from '@/lib/document-recovery';\nconfigureDashboardLocaleLoading(runOptionalLoad);" : ''}
reloadOnceOnChunkLoadFailure();
const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
document.documentElement.setAttribute('data-locale', locale);
${phase === 'after' ? 'await prepareDashboardLocale(locale);' : ''}
await setLanguage(locale);
window.__fixtureSetLanguage = setLanguage;
function Screen() {
  const { t, locale } = useLocale();
  const [open, setOpen] = useState(false);
  return <ThemeProvider defaultTheme={params.get('theme') === 'dark' ? 'dark' : 'light'}><DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
    <SidebarProvider><OrgSidebar orgSlug="fixture" isAdmin /><SidebarInset>
      <header className="flex h-14 items-center gap-3 border-b px-4"><SidebarTrigger label={t('nav.toggleSidebar')} /><span className="flex-1">Fixture Studio</span><Button onClick={() => setOpen(true)} data-language-button>{t('account.language')}</Button></header>
      <main className="p-4 sm:p-8"><PageHeader title={t('nav.websites')} description={t('organization.websites.subtitle', { org: 'Fixture Studio' })} />
      <section className="mt-6 rounded-xl border bg-card p-6"><h2 className="text-lg font-semibold">{t('organization.websites.emptyAdminTitle')}</h2><p className="mt-2 text-muted-foreground">{t('organization.websites.emptyAdmin', { org: 'Fixture Studio' })}</p><Button className="mt-5">{t('organization.websites.createFirst')}</Button></section></main>
    </SidebarInset></SidebarProvider><InterfaceLanguageDialog open={open} onOpenChange={setOpen} />
  </DirectionProvider></ThemeProvider>;
}
const root = createRootRoute({ component: Screen });
const page = createRoute({ getParentRoute: () => root, path: '/app/o/$orgSlug/websites', component: () => null });
const router = createRouter({ routeTree: root.addChildren([page]), history: createMemoryHistory({ initialEntries: ['/app/o/fixture/websites'] }) });
await router.load();
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
`,
    );
    await build({
      configFile: false,
      root: harness,
      base: '/',
      logLevel: 'warn',
      resolve: { alias: { '@': join(app, 'src') }, conditions: ['nibleaf-dashboard', ...defaultClientConditions] },
      plugins: [
        (await fromApp('@vitejs/plugin-react')).default(),
        (await fromApp('@tailwindcss/vite')).default(),
        {
          name: 'locale-fixture',
          enforce: 'pre',
          resolveId(source) {
            // The fixture lives outside apps/app; resolve its workspace imports
            // from the app while retaining Vite's explicit client conditions.
            if (source.startsWith('@nibleaf/')) return this.resolve(source, join(app, 'package.json'), { skipSelf: true });
          },
          load(file) {
            const path = file.replaceAll('\\', '/');
            // Account data is absent from this fixture. Keep the real sidebar,
            // language dialog, shell primitives and translator on both revisions.
            if (path.endsWith('/components/app/sidebar-account-footer.tsx')) return 'export function SidebarAccountFooter() { return null; }';
            if (phase === 'before')
              for (const [relative, source] of Object.entries(baselineSources)) if (path.endsWith(`/${relative}`)) return source;
          },
        },
      ],
      build: { outDir: join(harness, 'dist'), target: 'esnext', manifest: true },
    });
  }
} else {
  assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK, 'Set the canonical devstack directory lock');
  // Bind and immediately close to verify the assigned app port is free. Pages
  // below are served through interception: no server process is started.
  await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(4310, '127.0.0.1', () => probe.close(resolvePort));
  });
  const owner = `ui/627-builder capture pid=${process.pid}`;
  let stopRuntime = async () => undefined;
  let runtimeStopFailure;
  let closeBrowser = async () => undefined;
  const lock = await acquireDevstackLock(owner, {
    onInterrupt: async () => {
      await closeBrowser();
      await stopRuntime();
    },
  });
  try {
    const results = [];
    const beforeText = new Map();
    await withLocalOnlyBrowser(
      { allowedHosts: [hostKey(origin)], launch: { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false } },
      async ({ browser, attempted }) => {
        closeBrowser = () => browser.close();
        for (const phase of ['before', 'after'])
          for (const locale of ['en', 'ar'])
            for (const width of [390, 1440])
              for (const theme of ['light', 'dark']) {
                const context = await browser.newContext({
                  viewport: { width, height: width === 390 ? 844 : 900 },
                  isMobile: width === 390,
                  hasTouch: width === 390,
                  deviceScaleFactor: 1,
                  reducedMotion: 'reduce',
                });
                const tab = await context.newPage();
                const errors = [];
                const assets = [];
                tab.on('pageerror', (error) => errors.push(error.message));
                await tab.route(`${origin}/**`, async (route) => {
                  const url = new URL(route.request().url());
                  assets.push(url.pathname);
                  const file = join(scratch, phase, 'dist', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
                  try {
                    await route.fulfill({
                      status: 200,
                      contentType:
                        { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] ??
                        'application/octet-stream',
                      body: await readFile(file),
                    });
                  } catch {
                    await route.fulfill({ status: 404, body: '' });
                  }
                });
                await tab.goto(`${origin}/?locale=${locale}&theme=${theme}`);
                await tab.locator('[data-language-button]').waitFor();
                await tab.evaluate(() => document.fonts.ready.then(() => undefined));
                const text = await tab.locator('body').innerText();
                const profile = `${locale}-${width}-${theme}`;
                if (phase === 'before') beforeText.set(profile, text);
                else assert.equal(text, beforeText.get(profile), 'Visible fixture copy is unchanged');
                await tab.screenshot({ path: join(output, `${phase}-${locale}-${width}-${theme}.png`), fullPage: true });
                assert.deepEqual(errors, []);
                assert.equal(await tab.locator('html').getAttribute('lang'), locale);
                if (phase === 'after') {
                  const manifest = JSON.parse(await readFile(join(scratch, phase, 'dist/.vite/manifest.json'), 'utf8'));
                  for (const [source, entry] of Object.entries(manifest)) {
                    const catalogLocale = source.match(/generated\/dashboard\/messages\/([^/]+)\.js$/)?.[1];
                    if (catalogLocale && catalogLocale !== 'en' && catalogLocale !== locale)
                      assert.ok(!assets.includes(`/${entry.file}`), `Did not request nonactive catalog ${catalogLocale}`);
                  }
                }
                results.push({ phase, locale, width, theme, assets, errors, text });
                await context.close();
              }
        const { createServer: createDevServer } = await fromApp('vite');
        const devGeneration = await checkDevGeneration(
          root,
          scratch,
          browser,
          (cleanup) => {
            stopRuntime = cleanup;
          },
          createDevServer,
        );
        const preview = await withPrivatePreviewRuntime(
          root,
          scratch,
          async () => {
            const checks = [];
            for (const locale of ['en', 'ar']) {
              const messages = JSON.parse(await readFile(join(root, `packages/i18n/messages/${locale}.json`), 'utf8'));
              const response = await fetch(`${origin}/git-preview/fixture-private-preview`, {
                headers: { cookie: `NIBLEAF_LOCALE=${locale}`, 'accept-language': 'en-US' },
              });
              const html = await response.text();
              assert.equal(response.status, 200);
              assert.ok(html.includes(messages.preview_privatetitle), "Actual SSR contains the locale's private-preview title");
              const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 900 } });
              await context.addCookies([{ name: 'NIBLEAF_LOCALE', value: locale, url: origin }]);
              const tab = await context.newPage();
              const errors = [];
              tab.on('pageerror', (error) => errors.push(error.message));
              tab.on('console', (message) => {
                if (/hydration|did not match/i.test(message.text())) errors.push(message.text());
              });
              await tab.goto(`${origin}/git-preview/fixture-private-preview`);
              await tab.getByRole('heading', { name: messages.preview_privatetitle, exact: true }).waitFor();
              await tab.waitForLoadState('networkidle');
              assert.deepEqual(errors, []);
              assert.equal(await tab.locator('html').getAttribute('data-locale'), locale);
              checks.push({ locale, status: response.status, title: messages.preview_privatetitle, errors });
              await context.close();
            }
            return checks;
          },
          (cleanup) => {
            stopRuntime = cleanup;
          },
        );
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          recordVideo: { dir: output, size: { width: 1440, height: 900 } },
        });
        const tab = await context.newPage();
        const manifest = JSON.parse(await readFile(join(scratch, 'after/dist/.vite/manifest.json'), 'utf8'));
        const german = Object.entries(manifest).find(([source]) => source.endsWith('/generated/dashboard/messages/de.js'))?.[1]?.file;
        assert.ok(german, 'German has its own dynamic fixture chunk');
        let failGerman = true;
        await tab.route(`${origin}/**`, async (route) => {
          const url = new URL(route.request().url());
          if (failGerman && url.pathname === `/${german}`) {
            failGerman = false;
            await route.fulfill({ status: 503, body: 'fixture unavailable' });
            return;
          }
          const file = join(scratch, 'after/dist', url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
          try {
            await route.fulfill({
              status: 200,
              contentType:
                { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] ??
                'application/octet-stream',
              body: await readFile(file),
            });
          } catch {
            await route.fulfill({ status: 404, body: '' });
          }
        });
        await tab.goto(`${origin}/?locale=en&theme=light`);
        await tab.evaluate(() => {
          window.__localeFixtureMarker = 627;
        });
        await tab.locator('[data-language-button]').click();
        await tab.getByRole('option', { name: /Deutsch/ }).click();
        await tab.waitForTimeout(500);
        assert.equal(await tab.locator('html').getAttribute('lang'), 'en', 'Failed download preserves the active UI');
        assert.equal(await tab.evaluate(() => window.__localeFixtureMarker), 627, 'Failed locale download did not reload');
        await tab.locator('[data-language-button]').click();
        await tab.getByRole('option', { name: /Deutsch/ }).click();
        await tab.locator('html[lang="de"]').waitFor();
        await tab.evaluate(() => window.__fixtureSetLanguage('en'));
        await tab.locator('[data-language-button]').click();
        await tab.getByRole('option', { name: /العربية/ }).click();
        await tab.locator('html[lang="ar"][dir="rtl"]').waitFor();
        await tab.waitForTimeout(750);
        await tab.locator('[data-language-button]').click();
        await tab.getByRole('option', { name: /English/ }).click();
        await tab.locator('html[lang="en"][dir="ltr"]').waitFor();
        assert.equal(await tab.evaluate(() => window.__localeFixtureMarker), 627, 'Switch did not reload the document');
        await tab.waitForTimeout(750);
        const recording = tab.video();
        await context.close();
        if (recording) await rename(await recording.path(), join(output, 'language-switch.webm'));
        await writeFile(
          join(output, 'browser-results.json'),
          `${JSON.stringify({ baseline, nonLocalAttempts: attempted.length, profiles: results, devGeneration, privatePreview: preview }, null, 2)}\n`,
        );
      },
    );
  } finally {
    // A runtime that may still own the ports keeps the lock held.
    await stopRuntime().then(
      () => releaseOwnedDevstack(lock, owner),
      (error) => {
        lock.keep();
        runtimeStopFailure = error;
      },
    );
  }
  if (runtimeStopFailure) throw runtimeStopFailure;
}
