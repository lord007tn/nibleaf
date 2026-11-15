// Isolated component fixture of Site settings → Integrations → Analytics: the
// real section (before: the main-branch component; after:
// features/site-analytics-settings) with the real design system and EN/AR
// catalogs, given a fictional site. The one API call, the config PATCH, is
// answered by interception, merging `config.analytics` one level deep as the
// API does. Not the signed-in dashboard and not production. No server starts.
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
const beforeSource = git('show', `${baseline}:apps/app/src/components/project-settings/analytics-section.tsx`).replace(
  "from './shared'",
  "from '@/components/project-settings/shared'",
);
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://analytics.fixture.test';
/** The fictional site's saved analytics config. */
const savedAnalytics = { ga4: 'G-4H7K2M9Q1Z', cookieConsent: true };

const lock = await acquireDevstackLock('site analytics settings captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.analytics-capture-'));
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-analytics-settings";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../src/components/ui";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useT } from '@nibleaf/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import { AnalyticsSettings } from '@/features/site-analytics-settings/components/analytics-settings';
import { AnalyticsSection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
document.documentElement.classList.add(params.get('theme') === 'dark' ? 'dark' : 'light');
const project = { id: 'site-1', name: 'Handbook', slug: 'handbook', config: { theme: { preset: 'nib' }, analytics: ${JSON.stringify(savedAnalytics)} } };
const Section = params.get('phase') === 'before' ? BeforeSection : AnalyticsSettings;
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** The integration detail the section opens in: the way back, then the section. */
function Detail() {
  const t = useT();
  return (
    <div className="flex flex-col gap-4">
      <Button className="w-fit" size="sm" type="button" variant="ghost">
        <ArrowLeft className="rtl:-scale-x-100" />
        {t('settings.integrations.allIntegrations')}
      </Button>
      <Section project={project as never} />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="mx-auto w-full max-w-3xl p-4 text-foreground sm:p-8"><Detail /></main>
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
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };

  /** Opens the fixture; the PATCH is answered after `delay` ms with the merged config, as the API merges it. */
  async function open(context, { phase, locale, theme }, { delay = 0 } = {}) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) {
        const body = request.postDataJSON();
        requests.push({ method: request.method(), path: pathname, body });
        assert.equal(`${request.method()} ${pathname}`, 'PATCH /api/app/projects/site-1');
        await new Promise((done) => setTimeout(done, delay));
        const analytics = { ...savedAnalytics, ...body.config.analytics };
        const data = { id: 'site-1', name: 'Handbook', slug: 'handbook', config: { theme: { preset: 'nib' }, analytics } };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
        return;
      }
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}&theme=${theme}`);
    await page.locator('[role="switch"]').nth(1).waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests };
  }

  const ga4 = (page) => page.locator('input[placeholder="G-XXXXXXXXXX"]');
  const plausible = (page) => page.locator('input[placeholder="docs.yoursite.com"]');
  const switches = (page) => page.locator('[role="switch"]');
  const shownErrors = (page, locale) =>
    page.evaluate(
      (messages) => messages.filter((message) => document.body.innerText.includes(message)),
      [catalogs[locale].settings_analytics_ga4_error, catalogs[locale].settings_analytics_plausible_error],
    );
  const saveLabel = (locale) => catalogs[locale].common_save;
  /** What a reviewer should see: the fields, the switches, the errors and whether a Save button shows. */
  const state = async (page, locale) => ({
    dir: await page.evaluate(() => document.documentElement.dir),
    inputs: { ga4: await ga4(page).inputValue(), plausible: await plausible(page).inputValue() },
    inputDir: { ga4: await ga4(page).getAttribute('dir'), plausible: await plausible(page).getAttribute('dir') },
    switches: await switches(page).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-checked') === 'true')),
    errorsShown: await shownErrors(page, locale),
    saveButtonVisible: await page.getByRole('button', { name: saveLabel(locale), exact: true }).isVisible(),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  });

  // Each scene: what the person does before the capture.
  const scenes = {
    pristine: async () => ({}),
    dirty: async (page) => {
      await plausible(page).fill('docs.handbook.example');
      await switches(page).nth(0).click();
      return {};
    },
    error: async (page, locale) => {
      await ga4(page).fill('UA-1234-1');
      const errorsWhileTyping = await shownErrors(page, locale);
      await ga4(page).press('Enter');
      await page.waitForTimeout(100);
      return { errorsWhileTyping };
    },
  };

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390])
        for (const [scene, act] of Object.entries(scenes))
          for (const phase of ['before', 'after']) {
            const shots = {};
            const themes = {};
            for (const theme of ['light', 'dark']) {
              const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
              const { page, errors, requests } = await open(context, { phase, locale, theme });
              const observed = await act(page, locale);
              await page.mouse.move(0, 0);
              const seen = { ...(await state(page, locale)), ...observed, requests, pageErrors: errors };
              assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
              assert.equal(seen.overflow, false);
              assert.deepEqual(errors, []);
              assert.deepEqual(seen.inputDir, { ga4: 'ltr', plausible: 'ltr' });
              shots[theme] = await page.screenshot({ fullPage: true, animations: 'disabled' });
              themes[theme] = seen;
              await context.close();
            }
            assert.deepEqual({ ...themes.light, pageErrors: [] }, { ...themes.dark, pageErrors: [] });
            const file = `${scene}-${phase}-${locale}-${width}.png`;
            // Light and dark side by side under a caption that says what this is.
            const sheet = await browser.newContext({ viewport: { width: width * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
            const sheetPage = await sheet.newPage();
            const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
            await sheetPage.setContent(
              `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Analytics section · ${phase} · ${scene} · ${locale.toUpperCase()} · ${width}px</div>
<div style="display:flex;gap:16px;align-items:flex-start">${['light', 'dark']
                .map(
                  (theme) =>
                    `<figure style="margin:0"><figcaption style="margin-bottom:4px">${theme}</figcaption><img src="${img(shots[theme])}" width="${width}"></figure>`,
                )
                .join('')}</div></body>`,
            );
            await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
            await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true });
            await sheet.close();
            const { pageErrors, ...seen } = themes.light;
            captures.push({ file, phase, scene, locale, width, themes: ['light', 'dark'], ...seen, pageErrors });
          }

    // A short recording of the new form: blur and submit timing, a switch, a slow save, an edit during it, discard.
    for (const [locale, width] of [
      ['en', 1440],
      ['ar', 390],
    ]) {
      const file = `flow-after-${locale}-${width}.webm`;
      const context = await browser.newContext({
        viewport: { width, height: 760 },
        reducedMotion: 'reduce',
        recordVideo: { dir: harness, size: { width, height: 760 } },
      });
      const { page, errors, requests } = await open(context, { phase: 'after', locale, theme: 'light' }, { delay: 1200 });
      const pause = () => page.waitForTimeout(700);
      const steps = [];
      const note = async (step) => steps.push({ step, ...(await state(page, locale)) });
      await pause();
      await note('opened: pristine, no save bar');
      await ga4(page).click();
      await ga4(page).fill('');
      await ga4(page).pressSequentially('UA-1234', { delay: 60 });
      await note('typed an invalid id: no error while typing');
      await plausible(page).click();
      await pause();
      await note('left the field: its error shows');
      await ga4(page).fill('');
      await ga4(page).pressSequentially('G-4H7K2M9Q1Z', { delay: 60 });
      await note('fixed it: the error clears as it is typed');
      await switches(page).nth(0).click();
      await pause();
      await note('campaign dimensions on: still dirty');
      await page.getByRole('button', { name: saveLabel(locale), exact: true }).click();
      await page.waitForTimeout(300);
      await plausible(page).fill('docs.handbook.example');
      await note('typed during the pending save');
      await page.waitForTimeout(1400);
      await note('save answered: the newer edit stays, still unsaved');
      await page.getByRole('button', { name: catalogs[locale].forms_discard, exact: true }).click();
      await pause();
      await note('discarded: back to what the server holds');
      assert.deepEqual(errors, []);
      assert.equal(requests.length, 1);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });
    }

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real Analytics section (before: main; after: this branch) with the real design system and EN/AR catalogs in an integration-detail frame; fictional site; the config PATCH answered by interception with a one-level analytics merge like the API; not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/components/project-settings/analytics-section.tsx'],
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} captures and ${recordings.length} recordings; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
