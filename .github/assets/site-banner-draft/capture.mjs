// Isolated component fixture for Site configuration → Banner: the real section
// (before: the main-branch banner-section.tsx; after: features/site-banner) with
// the real design system, EN/AR catalogs, Query cache and mutations. The API is
// answered by interception with fictional data. A "refetch" is new project data
// handed to the section, which is what its host does after a query refetch.
// These are not signed-in dashboard or production captures. No server is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
const beforeSource = git('show', `${baseline}:apps/app/src/components/project-settings/banner-section.tsx`).replace(
  "from './shared'",
  "from '@/components/project-settings/shared'",
);
const origin = 'http://banner.fixture.test';

const PROJECT_BANNER = {
  enabled: true,
  dismissible: true,
  message: 'Spring sale: 20% off annual plans',
  linkLabel: 'See plans',
  linkUrl: 'https://example.com/pricing',
};
const LANGUAGES = [
  { id: 'en', code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, position: 0, config: null },
  { id: 'ar', code: 'ar', label: 'العربية', direction: 'RTL', isDefault: false, enabled: true, position: 1, config: null },
  { id: 'fr', code: 'fr', label: 'Français', direction: 'LTR', isDefault: false, enabled: true, position: 2, config: null },
];

const lock = await acquireDevstackLock('site banner draft captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.banner-capture-'));
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-banner";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BannerSettings } from '@/features/site-banner/components/banner-settings';
import { queryKeys } from '@/hooks/api/query-keys';
import { BannerSection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add(params.get('theme') === 'dark' ? 'dark' : 'light');
const client = new QueryClient({ defaultOptions: { queries: { staleTime: Number.POSITIVE_INFINITY, retry: false }, mutations: { retry: false } } });
client.setQueryData(queryKeys.languages.all('site-1'), ${JSON.stringify(LANGUAGES)});
const Section = params.get('phase') === 'before' ? BeforeSection : BannerSettings;

function Host() {
  const [project, setProject] = useState({ id: 'site-1', config: { banner: ${JSON.stringify(PROJECT_BANNER)} } });
  // What the host hands down after a refetch: the project, changed elsewhere.
  Object.assign(window, { serverChange: (banner: object) => setProject((old) => ({ ...old, config: { banner: { ...old.config.banner, ...banner } } })) });
  return <Section project={project as never} />;
}

createRoot(document.getElementById('root')!).render(
  <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col p-4 text-foreground sm:p-8"><Host /></main>
        <Toaster position={locale === 'ar' ? 'bottom-left' : 'bottom-right'} richColors />
      </ConfirmProvider>
    </QueryClientProvider>
  </DirectionProvider>,
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

  /** Serves the build and answers the API: saves fail or succeed per `api.mode`; every request is recorded. */
  const serve = async (context, api) => {
    await context.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === '/sheet') return route.fulfill({ body: '<!doctype html><title>sheet</title>', contentType: 'text/html' });
      if (pathname.startsWith('/api/')) {
        api.requests.push(`${request.method()} ${pathname}`);
        if (request.method() === 'GET') return route.fulfill({ json: { data: LANGUAGES } });
        if (api.mode === 'fail') return route.fulfill({ status: 500, json: { error: { message: 'Simulated failure' } } });
        const body = request.postDataJSON();
        const config = body.config ?? {};
        return route.fulfill({ json: { data: pathname.includes('/languages/') ? { ...LANGUAGES[1], config } : { id: 'site-1', config } } });
      }
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      return route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
  };

  // Structural selectors, so one script drives both locales and both components.
  const switches = (page) => page.locator('main [role="switch"]');
  const textInputs = (page) => page.locator('main input[dir]');
  const saveButton = (page, phase) =>
    phase === 'before' ? page.locator('main form button[type="submit"]') : page.locator('[data-slot="save-region"] button').last();
  const chooseScope = (page, label) => page.locator('main button', { hasText: label }).click();
  const settle = (page, ms = 300) => page.waitForTimeout(ms);

  const scenes = [
    {
      name: 'dirty',
      label: 'Unsaved edits, Default scope: Dismissible turned off and the message changed',
      run: async (page) => {
        await switches(page).nth(1).click();
        await textInputs(page).nth(0).fill('Summer sale: 30% off annual plans');
        await settle(page);
      },
    },
    {
      name: 'failed',
      label: 'Failed save, Arabic scope: the server refused, the draft stays',
      run: async (page, phase, api) => {
        await chooseScope(page, 'العربية');
        await textInputs(page).nth(0).fill('تخفيضات الربيع: خصم ٢٠٪ على الخطط السنوية');
        await switches(page).nth(1).click();
        api.mode = 'fail';
        await saveButton(page, phase).click();
        await page.locator('[data-sonner-toast]').first().waitFor({ timeout: 10_000 });
        await settle(page, 600);
      },
    },
    {
      name: 'refetch',
      label: 'Clean form, then the server turned Dismissible off and changed the message',
      run: async (page) => {
        await page.evaluate(() => window.serverChange({ dismissible: false, message: 'Summer sale: 30% off annual plans' }));
        await settle(page);
      },
    },
  ];

  const state = async (page, phase) => ({
    toggles: await switches(page).evaluateAll((items) => items.map((item) => item.getAttribute('aria-checked') === 'true')),
    fields: await textInputs(page).evaluateAll((items) => items.map((item) => ({ value: item.value, dir: item.dir, placeholder: item.placeholder }))),
    saveVisible: phase === 'before' ? await saveButton(page, phase).isEnabled() : (await page.locator('[data-slot="save-region"]').count()) > 0,
    toast: (await page.locator('[data-sonner-toast]').allTextContents()).join(' ').trim() || null,
  });

  /** Lays two screenshots per scene side by side under labels, in a canvas on the fixture origin. */
  const sheet = async (context, title, rows) => {
    const page = await context.newPage();
    await page.goto(`${origin}/sheet`);
    const png = await page.evaluate(
      async ({ title, rows }) => {
        const load = (src) =>
          new Promise((done, fail) => {
            const image = new Image();
            image.onload = () => done(image);
            image.onerror = fail;
            image.src = src;
          });
        const loaded = await Promise.all(rows.map(async (row) => ({ ...row, before: await load(row.before), after: await load(row.after) })));
        const gap = 24;
        const band = 40;
        const column = Math.max(...loaded.flatMap((row) => [row.before.width, row.after.width]));
        const width = column * 2 + gap * 3;
        const height = band + loaded.reduce((sum, row) => sum + band + Math.max(row.before.height, row.after.height) + gap, gap);
        const canvas = Object.assign(document.createElement('canvas'), { width, height });
        const draw = canvas.getContext('2d');
        draw.fillStyle = '#e5e7eb';
        draw.fillRect(0, 0, width, height);
        draw.fillStyle = '#111827';
        draw.font = 'bold 20px sans-serif';
        draw.fillText(title, gap, 28);
        let y = band + gap;
        for (const row of loaded) {
          draw.font = '16px sans-serif';
          draw.fillText(`Before (main) · ${row.label}`, gap, y + 24);
          draw.fillText(`After (this PR) · ${row.label}`, gap * 2 + column, y + 24);
          draw.drawImage(row.before, gap, y + band);
          draw.drawImage(row.after, gap * 2 + column, y + band);
          y += band + Math.max(row.before.height, row.after.height) + gap;
        }
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { title, rows },
    );
    await page.close();
    return Buffer.from(png, 'base64');
  };

  const captures = [];
  const sheets = [];
  let recording;
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390])
        for (const theme of ['light', 'dark']) {
          const rows = [];
          for (const scene of scenes) {
            const shots = {};
            for (const phase of ['before', 'after']) {
              const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: theme });
              const api = { mode: 'ok', requests: [] };
              await serve(context, api);
              const page = await context.newPage();
              const errors = [];
              page.on('pageerror', (error) => errors.push(error.message));
              await page.goto(`${origin}/?locale=${locale}&phase=${phase}&theme=${theme}`);
              await switches(page).first().waitFor({ timeout: 15_000 });
              await scene.run(page, phase, api);
              await page.evaluate(() => document.fonts.ready);
              const dir = await page.evaluate(() => document.documentElement.dir);
              const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
              const observed = await state(page, phase);
              assert.equal(dir, locale === 'ar' ? 'rtl' : 'ltr');
              assert.equal(overflow, false);
              assert.deepEqual(errors, []);
              if (scene.name === 'refetch') {
                // The regression: the old toggle kept its first value; the draft takes the server's.
                assert.equal(observed.toggles[1], phase === 'before');
                if (phase === 'after') assert.equal(observed.saveVisible, false);
              }
              if (scene.name === 'failed') {
                assert.equal(observed.fields[0].value, 'تخفيضات الربيع: خصم ٢٠٪ على الخطط السنوية');
                assert.equal(observed.fields[0].dir, 'rtl');
                assert.ok(observed.toast);
                assert.deepEqual(api.requests, ['PATCH /api/app/projects/site-1/languages/ar']);
                if (phase === 'after') assert.equal(observed.saveVisible, true);
              }
              const shot = await page.screenshot({ fullPage: true, animations: 'disabled' });
              shots[phase] = `data:image/png;base64,${shot.toString('base64')}`;
              captures.push({ scene: scene.name, phase, locale, width, theme, dir, overflow, errors, requests: api.requests, ...observed });
              await context.close();
            }
            rows.push({ label: scene.label, ...shots });
          }
          const file = `sheet-${locale}-${width}-${theme}.png`;
          const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
          await serve(context, { mode: 'ok', requests: [] });
          await writeFile(
            resolve(import.meta.dirname, file),
            await sheet(context, `Component fixture, not the dashboard · Banner · ${locale.toUpperCase()} · ${width} px · ${theme}`, rows),
          );
          await context.close();
          sheets.push(file);
        }

    // One recorded flow (after): a toggle-only edit, a failed save, a retry that saves, then a scope switch that asks first.
    const videoDir = await mkdtemp(resolve(harness, 'video-'));
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
      recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
    });
    const api = { mode: 'fail', requests: [] };
    await serve(context, api);
    const page = await context.newPage();
    await page.goto(`${origin}/?locale=en&phase=after&theme=light`);
    await switches(page).first().waitFor({ timeout: 15_000 });
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page, 'after')) });
    await settle(page, 800);
    await switches(page).nth(1).click();
    await note('Turned Dismissible off: a toggle alone makes the form dirty');
    await settle(page, 1000);
    await textInputs(page).nth(0).pressSequentially(' (ends Friday)', { delay: 40 });
    await note('Typed into the message');
    await settle(page, 600);
    await saveButton(page, 'after').click();
    await page.locator('[data-sonner-toast]').first().waitFor({ timeout: 10_000 });
    await settle(page, 600);
    await note('Save failed: the toast says so, the draft and the bar stay');
    await settle(page, 1800);
    api.mode = 'ok';
    await saveButton(page, 'after').click();
    await page.locator('[data-slot="save-region"]').waitFor({ state: 'detached', timeout: 10_000 });
    await note('Saved on retry: the bar closes');
    await settle(page, 1200);
    await textInputs(page).nth(1).fill('Compare plans');
    await note('A new edit');
    await settle(page, 600);
    await chooseScope(page, 'العربية');
    await page.locator('[role="dialog"], [role="alertdialog"]').first().waitFor({ timeout: 5000 });
    await note('Switching scope with an edit asks first');
    await settle(page, 1500);
    await page.locator('[role="dialog"] button, [role="alertdialog"] button').last().click();
    await settle(page, 800);
    await note('Discarded and switched: the Arabic scope opens clean, with the project text as placeholders');
    await settle(page, 1200);
    const video = page.video();
    await context.close();
    recording = 'flow-after-en-1440.webm';
    await rename(await video.path(), resolve(import.meta.dirname, recording));
    assert.equal(steps.at(-1).fields[0].value, '');
    assert.equal(steps.at(-1).fields[0].dir, 'rtl');
    assert.equal(steps.at(-1).saveVisible, false);
    assert.deepEqual(api.requests, ['PATCH /api/app/projects/site-1', 'PATCH /api/app/projects/site-1']);

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Isolated component fixture: the real banner section (before: main; after: this PR) with the real design system, EN/AR catalogs, Query cache and mutations; API answered by interception with fictional data. Not the dashboard and not production.',
      baseline,
      head: git('rev-parse', 'HEAD'),
      attempted: attempted.length,
      sheets,
      captures,
      recording: { file: recording, locale: 'en', width: 1440, theme: 'light', requests: api.requests, steps },
    });
  });
  console.log(`${captures.length} captures in ${sheets.length} sheets and ${recording}; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
