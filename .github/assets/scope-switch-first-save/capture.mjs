// Isolated component fixture for #770: Site configuration → Banner, the real
// section with the real design system, EN/AR catalogs, Query cache and
// mutations, built twice: before with `use-server-draft.ts` from the merge base
// with main, after with this branch's. The API is answered by interception
// with fictional data. These are not signed-in dashboard or production
// captures. No server is started.
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
const forms = resolve(app, 'src/lib/forms');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
const beforeHook = git('show', `${baseline}:apps/app/src/lib/forms/use-server-draft.ts`).replace(
  "from './server-draft'",
  `from '${resolve(forms, 'server-draft').replaceAll('\\', '/')}'`,
);
const origin = 'http://scope-switch.fixture.test';

const SITE = '00000000-0000-4000-8000-000000000001';
const PROJECT_PATH = `/api/app/projects/${SITE}`;
const PROJECT_BANNER = { enabled: true, dismissible: true, message: 'Spring sale', linkLabel: '', linkUrl: '' };
const LANGUAGES = [
  {
    id: '00000000-0000-4000-8000-000000000002',
    code: 'en',
    label: 'English',
    direction: 'LTR',
    isDefault: true,
    enabled: true,
    position: 0,
    config: null,
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    code: 'fr',
    label: 'Français',
    direction: 'LTR',
    isDefault: false,
    enabled: true,
    position: 1,
    config: null,
  },
];
const FRENCH_PATH = `${PROJECT_PATH}/languages/${LANGUAGES[1].id}`;
const DEFAULT_TEXT = 'Summer sale';
const FRENCH_TEXT = "Soldes d'été";

const lock = await acquireDevstackLock('#770 scope switch captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.scope-switch-capture-'));
  await writeFile(resolve(harness, 'before-use-server-draft.ts'), `${beforeHook}\n`);
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
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { BannerSettings } from '@/features/site-banner/components/banner-settings';
import { projectQueryOptions } from '@/hooks/api/query-options';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add(params.get('theme') === 'dark' ? 'dark' : 'light');
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Like the app's hosts: the project comes from its query, so a save's invalidation refetches it. */
function Host() {
  const { data: project } = useQuery(projectQueryOptions('${SITE}'));
  return project ? <BannerSettings project={project} /> : null;
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
  const dists = {};
  let swapped = 0;
  for (const phase of ['before', 'after']) {
    const outDir = resolve(harness, `dist-${phase}`);
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
        // Before: every import of the hook takes main's copy; nothing else differs.
        // The `@/` alias has already made `source` absolute by now.
        {
          name: 'hook-phase',
          enforce: 'pre',
          resolveId: (source, importer) => {
            if (phase !== 'before') return;
            const path = source.replaceAll('\\', '/');
            const fromForms = importer?.replaceAll('\\', '/').includes('/src/lib/forms/') && path === './use-server-draft';
            if (!fromForms && !/\/src\/lib\/forms\/use-server-draft(\.ts)?$/.test(path)) return;
            swapped += 1;
            return resolve(harness, 'before-use-server-draft.ts');
          },
        },
        (await fromApp('@vitejs/plugin-react')).default(),
        (await fromApp('@tailwindcss/vite')).default(),
      ],
      build: { outDir, emptyOutDir: true, target: 'esnext' },
    });
    dists[phase] = outDir;
  }
  // The before build really took main's hook.
  assert.ok(swapped > 0);
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };

  /**
   * Serves one phase's build and answers the API: the Default (project) save
   * waits until `api.releaseDefault()`, a French save answers at once, and
   * every request is recorded when it arrives.
   */
  const serve = async (context, phase, api) => {
    const dist = dists[phase];
    const project = { id: SITE, name: 'Acme', config: { banner: { ...PROJECT_BANNER } } };
    const french = { ...LANGUAGES[1] };
    let release;
    const held = new Promise((done) => {
      release = done;
    });
    api.releaseDefault = () => release();
    await context.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === '/sheet') return route.fulfill({ body: '<!doctype html><title>sheet</title>', contentType: 'text/html' });
      if (pathname.startsWith('/api/')) {
        api.requests.push(`${request.method()} ${pathname}`);
        if (pathname === `${PROJECT_PATH}/languages`) return route.fulfill({ json: { data: [LANGUAGES[0], french] } });
        if (pathname === PROJECT_PATH && request.method() === 'GET') return route.fulfill({ json: { data: project } });
        if (pathname === PROJECT_PATH && request.method() === 'PATCH') {
          const { config } = request.postDataJSON();
          await held;
          Object.assign(project.config.banner, config.banner);
          return route.fulfill({ json: { data: project } });
        }
        if (pathname === FRENCH_PATH && request.method() === 'PATCH') {
          french.config = request.postDataJSON().config ?? null;
          return route.fulfill({ json: { data: french } });
        }
        return route.fulfill({ status: 404, json: { error: { message: 'Unexpected request' } } });
      }
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      return route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
  };

  const message = (page) => page.locator('main input[dir]').first();
  const bar = (page) => page.locator('[data-slot="save-region"]');
  const barSave = (page) => bar(page).locator('button').last();
  const settle = (page, ms = 300) => page.waitForTimeout(ms);
  const patches = (api) => api.requests.filter((request) => request.startsWith('PATCH'));

  const state = async (page, api) => ({
    message: await message(page).inputValue(),
    bar: (await bar(page).count()) > 0,
    barSave: (await bar(page).count()) > 0 ? { text: (await barSave(page).innerText()).trim(), enabled: await barSave(page).isEnabled() } : null,
    toast: (await page.locator('[data-sonner-toast]').allTextContents()).join(' ').trim() || null,
    focus: await page.evaluate(() => document.activeElement?.tagName ?? null),
    patches: patches(api),
  });

  /**
   * The flow: edit Default and save (held), switch to French and confirm,
   * type, then ask to save three ways: the bar's Save, Enter in the field,
   * Ctrl+S. The Default save stays pending throughout.
   */
  const flow = async (page, note = async () => undefined) => {
    await message(page).fill(DEFAULT_TEXT);
    await barSave(page).click();
    await page.waitForFunction(() => document.querySelector('[data-slot="save-region"]')?.textContent?.length);
    await settle(page);
    await note('Default edited and saved: its request is held by the API');
    await page.locator('main button', { hasText: 'Français' }).click();
    await page.locator('[role="dialog"], [role="alertdialog"]').first().waitFor({ timeout: 5000 });
    await settle(page, 400);
    await page.locator('[role="dialog"] button, [role="alertdialog"] button').last().click();
    await settle(page);
    await message(page).fill(FRENCH_TEXT);
    await settle(page);
    await note('Switched to French and typed, the Default save still pending');
    const tried = [];
    if (await barSave(page).isEnabled()) {
      await barSave(page).click();
      tried.push('bar Save');
    } else tried.push('bar Save disabled');
    await settle(page);
    await message(page).press('Enter');
    tried.push('Enter');
    await settle(page);
    await page.keyboard.press('Control+s');
    tried.push('Ctrl+S');
    await settle(page, 600);
    await note(`Asked to save French (${tried.join(', ')})`);
    return tried;
  };

  /** Lays two screenshots side by side under labels, in a canvas on the fixture origin. */
  const sheet = async (context, title, label, before, after) => {
    const page = await context.newPage();
    await page.goto(`${origin}/sheet`);
    const png = await page.evaluate(
      async ({ title, label, before, after }) => {
        const load = (src) =>
          new Promise((done, fail) => {
            const image = new Image();
            image.onload = () => done(image);
            image.onerror = fail;
            image.src = src;
          });
        const [left, right] = await Promise.all([load(before), load(after)]);
        const gap = 24;
        const top = 110;
        const column = Math.max(left.width, right.width);
        const width = column * 2 + gap * 3;
        const height = top + Math.max(left.height, right.height) + gap;
        const canvas = Object.assign(document.createElement('canvas'), { width, height });
        const draw = canvas.getContext('2d');
        draw.fillStyle = '#e5e7eb';
        draw.fillRect(0, 0, width, height);
        draw.fillStyle = '#111827';
        draw.font = 'bold 20px sans-serif';
        draw.fillText(title, gap, 28, width - gap * 2);
        draw.font = 'bold 16px sans-serif';
        draw.fillText(label, gap, 58, width - gap * 2);
        draw.font = '16px sans-serif';
        draw.fillText('Before (main)', gap, 90);
        draw.fillText('After (this PR)', gap * 2 + column, 90);
        draw.drawImage(left, gap, top);
        draw.drawImage(right, gap * 2 + column, top);
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { title, label, before, after },
    );
    await page.close();
    return Buffer.from(png, 'base64');
  };

  const captures = [];
  const sheets = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390])
        for (const theme of ['light', 'dark']) {
          const shots = {};
          for (const phase of ['before', 'after']) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: theme });
            const api = { requests: [] };
            await serve(context, phase, api);
            const page = await context.newPage();
            const errors = [];
            page.on('pageerror', (error) => errors.push(error.message));
            await page.goto(`${origin}/?locale=${locale}&theme=${theme}`);
            await message(page).waitFor({ timeout: 15_000 });
            const tried = await flow(page);
            await page.evaluate(() => document.fonts.ready);
            const asked = await state(page, api);
            const shot = await page.screenshot({ fullPage: true, animations: 'disabled' });
            shots[phase] = `data:image/png;base64,${shot.toString('base64')}`;
            // The Default save ends late.
            api.releaseDefault();
            await settle(page, 800);
            const afterDefault = await state(page, api);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
            assert.equal(overflow, false);
            assert.deepEqual(errors, []);
            assert.equal(asked.message, FRENCH_TEXT);
            assert.equal(afterDefault.message, FRENCH_TEXT);
            assert.equal(afterDefault.toast, null);
            if (phase === 'before') {
              // The defect: French's Save is held by the Default save; nothing is sent for French.
              assert.deepEqual(tried, ['bar Save disabled', 'Enter', 'Ctrl+S']);
              assert.deepEqual(asked.patches, [`PATCH ${PROJECT_PATH}`]);
              assert.equal(asked.barSave?.enabled, false);
              assert.deepEqual(afterDefault.patches, [`PATCH ${PROJECT_PATH}`]);
              assert.equal(afterDefault.barSave?.enabled, true);
            } else {
              // French's first Save sends once; Enter and Ctrl+S after it add nothing; the late Default end changes nothing.
              assert.deepEqual(tried, ['bar Save', 'Enter', 'Ctrl+S']);
              assert.deepEqual(asked.patches, [`PATCH ${PROJECT_PATH}`, `PATCH ${FRENCH_PATH}`]);
              assert.equal(asked.bar, false);
              assert.deepEqual(afterDefault.patches, asked.patches);
              assert.equal(afterDefault.bar, false);
            }
            captures.push({ phase, locale, width, theme, overflow, errors, tried, asked, afterDefault, requests: api.requests });
            await context.close();
          }
          const file = `sheet-${locale}-${width}-${theme}.png`;
          const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
          await serve(context, 'after', { requests: [] });
          await writeFile(
            resolve(import.meta.dirname, file),
            await sheet(
              context,
              `Component fixture, not the dashboard · Banner · ${locale.toUpperCase()} · ${width} px · ${theme}`,
              'Default save still pending; switched to Français, typed, then Save, Enter and Ctrl+S',
              shots.before,
              shots.after,
            ),
          );
          await context.close();
          sheets.push(file);
        }

    // One recorded flow per phase, EN, 1440, light.
    for (const phase of ['before', 'after']) {
      const videoDir = await mkdtemp(resolve(harness, 'video-'));
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
        recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
      });
      const api = { requests: [] };
      await serve(context, phase, api);
      const page = await context.newPage();
      await page.goto(`${origin}/?locale=en&theme=light`);
      await message(page).waitFor({ timeout: 15_000 });
      await settle(page, 800);
      const steps = [];
      const note = async (step) => {
        steps.push({ step, ...(await state(page, api)) });
        await settle(page, 1200);
      };
      await flow(page, note);
      api.releaseDefault();
      await settle(page, 800);
      await note('The Default save ended');
      if (phase === 'before') {
        await barSave(page).click();
        await settle(page, 800);
        await note('Save pressed again: only now is French sent');
        assert.deepEqual(patches(api), [`PATCH ${PROJECT_PATH}`, `PATCH ${FRENCH_PATH}`]);
      }
      const video = page.video();
      await context.close();
      const file = `flow-${phase}-en-1440.webm`;
      await rename(await video.path(), resolve(import.meta.dirname, file));
      recordings.push({ file, phase, locale: 'en', width: 1440, theme: 'light', requests: api.requests, steps });
    }

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Isolated component fixture: the real banner section with the real design system, EN/AR catalogs, Query cache and mutations; before uses use-server-draft.ts from main, after this branch’s. API answered by interception with fictional data. Not the dashboard and not production.',
      baseline,
      head: git('rev-parse', 'HEAD'),
      attempted: attempted.length,
      sheets,
      captures,
      recordings,
    });
  });
  console.log(
    `${captures.length} captures in ${sheets.length} sheets and ${recordings.length} recordings; no overflow, page errors or outside requests`,
  );
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
