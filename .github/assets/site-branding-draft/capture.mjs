// Isolated component fixture of Site configuration → Branding: the real
// section (before: the main-branch component; after: features/site-branding)
// with the real design system, EN/AR catalogs, project query, config mutation
// and shared upload hook, given a fictional site and a fictional local SVG.
// Every request is answered by interception on the fixture origin: the project
// GET (from an in-page store), the config PATCH (merged one level deep as the
// API does), and the upload's presign, PUT and confirm. Not the signed-in
// dashboard and not production. No server starts and nothing is uploaded.
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
const beforeSource = git('show', `${baseline}:apps/app/src/components/project-settings/branding-section.tsx`).replace(
  "from './shared'",
  "from '@/components/project-settings/shared'",
);
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://branding.fixture.test';
/** The fictional site's saved branding. */
const savedBranding = { logoLight: '/logo/light.svg', logoDark: '/logo/dark.svg', favicon: '/favicon.svg', logoHref: null };
const fictionalSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="40" viewBox="0 0 160 40"><rect width="40" height="40" rx="8" fill="#0f766e"/><text x="52" y="27" font-family="sans-serif" font-size="18" fill="#0f172a">Handbook</text></svg>\n';

const lock = await acquireDevstackLock('site branding draft captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.branding-capture-'));
  const logoFile = resolve(harness, 'handbook-logo.svg');
  await writeFile(logoFile, fictionalSvg);
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-branding";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../src/components/ui";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { BrandingSettings } from '@/features/site-branding/components/branding-settings';
import { useProject } from '@/hooks/api';
import { BrandingSection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.add(theme);
const Section = params.get('phase') === 'before' ? BeforeSection : BrandingSettings;
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });

/** The editor's Configuration canvas: the site from the project query, then the section, keyed by site as the host does. */
function Canvas() {
  const { data: project } = useProject('site-1');
  return project ? <Section key={project.id} project={project} /> : null;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="mx-auto w-full max-w-4xl px-5 pt-7 pb-32 text-foreground sm:px-8"><Canvas /></main>
    <Toaster theme={theme} />
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
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));

  /**
   * Opens the fixture over an in-page store of the site. `server.confirmDelay`
   * holds the upload's confirm, `server.saveDelay` the PATCH, and
   * `server.failNextUpload` refuses the next presign with a 413.
   */
  async function open(context, { phase, locale, theme }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { branding: { ...savedBranding }, confirmDelay: 0, saveDelay: 0, failNextUpload: false, uploads: 0 };
    const project = () => ({
      id: 'site-1',
      name: 'Handbook',
      slug: 'handbook',
      config: { theme: { preset: 'nib' }, branding: { ...server.branding } },
    });
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === 'GET /api/app/projects/site-1') {
        requests.push({ call });
        return json(route, { data: project() });
      }
      if (call === 'PATCH /api/app/projects/site-1') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        await wait(server.saveDelay);
        server.branding = { ...server.branding, ...body.config.branding };
        return json(route, { data: project() });
      }
      if (call === 'POST /api/app/projects/site-1/assets/presign') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        if (server.failNextUpload) {
          server.failNextUpload = false;
          return json(route, { error: { code: 'asset:too_large', message: 'The file is too large.' } }, 413);
        }
        server.uploads += 1;
        const key = `site-1/branding/${server.uploads}-${body.filename}`;
        return json(route, { data: { key, uploadUrl: `/storage/${key}`, contentType: body.contentType } });
      }
      if (request.method() === 'PUT' && pathname.startsWith('/storage/')) {
        requests.push({ call: 'PUT /storage/…', bytes: request.postDataBuffer()?.length ?? 0 });
        return route.fulfill({ status: 200, body: '' });
      }
      if (call === 'POST /api/app/projects/site-1/assets/confirm') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        await wait(server.confirmDelay);
        return json(route, {
          data: {
            id: `asset-${server.uploads}`,
            key: body.key,
            url: `${origin}/storage/${body.key}`,
            size: body.size,
            contentType: body.contentType,
          },
        });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}&theme=${theme}`);
    await field(page, 'logoLight').waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const PLACEHOLDERS = { logoLight: '/logo/light.svg', logoDark: '/logo/dark.svg', favicon: '/favicon.svg', logoHref: 'https://example.com' };
  const field = (page, name) => page.locator(`input[placeholder="${PLACEHOLDERS[name]}"]`);
  const uploadControl = (page, name) => field(page, name).locator('xpath=..');
  const choose = (page, name) => uploadControl(page, name).locator('input[type="file"]').setInputFiles(logoFile);
  const saveButton = (page, locale) => page.getByRole('button', { name: catalogs[locale].common_save, exact: true });
  /** What a reviewer should see: the fields, which uploads run, the toasts and whether a Save button shows. */
  const state = async (page, locale) => ({
    dir: await page.evaluate(() => document.documentElement.dir),
    fields: Object.fromEntries(await Promise.all(Object.keys(PLACEHOLDERS).map(async (name) => [name, await field(page, name).inputValue()]))),
    fieldDir: Object.fromEntries(
      await Promise.all(Object.keys(PLACEHOLDERS).map(async (name) => [name, await field(page, name).getAttribute('dir')])),
    ),
    uploading: Object.fromEntries(
      await Promise.all(
        ['logoLight', 'logoDark', 'favicon'].map(async (name) => [
          name,
          (await uploadControl(page, name).getByRole('button').getAttribute('aria-busy')) === 'true',
        ]),
      ),
    ),
    uploadButtonNames: await Promise.all(
      ['logoLight', 'logoDark', 'favicon'].map(async (name) =>
        uploadControl(page, name)
          .getByRole('button')
          .evaluate(
            (button) =>
              (button.getAttribute('aria-labelledby') ?? '')
                .split(' ')
                .map((id) => document.getElementById(id)?.textContent?.trim())
                .filter(Boolean)
                .join(' ') || button.textContent.trim(),
          ),
      ),
    ),
    toasts: await page.locator('[data-sonner-toast]').allInnerTexts(),
    saveButtonVisible: await saveButton(page, locale).isVisible(),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  });

  // Each scene: what the person does before the capture.
  const scenes = {
    pristine: { phases: ['before', 'after'], act: async () => undefined },
    uploaded: {
      phases: ['before', 'after'],
      act: async (page) => {
        await choose(page, 'logoDark');
        await page.waitForFunction((ph) => document.querySelector(`input[placeholder="${ph}"]`)?.value.startsWith('http'), PLACEHOLDERS.logoDark);
        await page.waitForTimeout(400);
      },
    },
    'upload-failed': {
      phases: ['after'],
      act: async (page, _locale, server) => {
        server.failNextUpload = true;
        await choose(page, 'favicon');
        await page.locator('[data-sonner-toast][data-type="error"]').waitFor();
        await page.waitForTimeout(400);
      },
    },
  };

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390])
        for (const [scene, { phases, act }] of Object.entries(scenes))
          for (const phase of phases) {
            const shots = {};
            const themes = {};
            for (const theme of ['light', 'dark']) {
              const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: theme });
              const { page, errors, requests, server } = await open(context, { phase, locale, theme });
              await act(page, locale, server);
              await page.mouse.move(0, 0);
              const seen = { ...(await state(page, locale)), requests, pageErrors: errors };
              assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
              assert.equal(seen.overflow, false);
              assert.deepEqual(errors, []);
              assert.deepEqual(Object.values(seen.fieldDir), ['ltr', 'ltr', 'ltr', 'ltr']);
              assert.ok(!requests.some(({ call }) => call.startsWith('PATCH')), 'an upload never saves the configuration');
              shots[theme] = await page.screenshot({ fullPage: true, animations: 'disabled' });
              themes[theme] = seen;
              await context.close();
            }
            const file = `${scene}-${phase}-${locale}-${width}.png`;
            // Light and dark side by side under a caption that says what this is.
            const sheet = await browser.newContext({ viewport: { width: width * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
            const sheetPage = await sheet.newPage();
            const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
            await sheetPage.setContent(
              `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Branding section · ${phase} · ${scene} · ${locale.toUpperCase()} · ${width}px</div>
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

    // The new form in use: upload → Save → refetch, then the races and a failure, read back step by step.
    for (const [locale, width] of [
      ['en', 1440],
      ['ar', 390],
    ]) {
      const file = `flow-after-${locale}-${width}.webm`;
      const context = await browser.newContext({
        viewport: { width, height: 820 },
        reducedMotion: 'reduce',
        recordVideo: { dir: harness, size: { width, height: 820 } },
      });
      const { page, errors, requests, server } = await open(context, { phase: 'after', locale, theme: 'light' });
      const pause = (ms = 700) => page.waitForTimeout(ms);
      const steps = [];
      const note = async (step) => steps.push({ step, ...(await state(page, locale)) });
      await pause();
      await note('opened: pristine, no save bar');

      server.confirmDelay = 1200;
      await choose(page, 'logoDark');
      await pause(300);
      await note('chose an image for the light-mode logo: its button shows progress, the others stay usable');
      await pause(1400);
      await note('upload finished: only that field is filled; the draft is unsaved and nothing was saved');

      server.saveDelay = 900;
      await saveButton(page, locale).click();
      await pause(300);
      await note('Save pressed: saving');
      await pause(1600);
      await note('saved and refetched: the field shows what the server holds, no save bar');

      server.confirmDelay = 1600;
      await choose(page, 'favicon');
      await pause(300);
      await field(page, 'favicon').fill('/brand/typed-meanwhile.svg');
      await note('race: typed in the favicon field while its upload runs');
      await pause(1800);
      await note('the late upload result did not overwrite the typed value');

      await field(page, 'logoHref').fill('https://handbook.example');
      await choose(page, 'logoLight');
      await pause(300);
      await page.getByRole('button', { name: catalogs[locale].forms_discard, exact: true }).click();
      await note('race: discarded while the dark-mode logo upload runs');
      await pause(1800);
      await note('the late upload result did not refill the discarded draft');

      server.confirmDelay = 0;
      server.failNextUpload = true;
      await choose(page, 'favicon');
      await page.locator('[data-sonner-toast][data-type="error"]').waitFor();
      await pause();
      await note('failure: the upload was refused; one message names the field, the value stays');

      assert.deepEqual(errors, []);
      assert.equal(requests.filter(({ call }) => call.startsWith('PATCH')).length, 1);
      assert.equal(steps.at(-1).fields.favicon, '/favicon.svg');
      assert.equal(new URL(steps[2].fields.logoDark).origin, origin);
      assert.equal(steps[4].saveButtonVisible, false);
      assert.equal(steps[6].fields.favicon, '/brand/typed-meanwhile.svg');
      assert.deepEqual(steps[8].fields, { ...steps[4].fields });
      assert.equal(steps[8].saveButtonVisible, false);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });
    }

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real Branding section (before: main; after: this branch) with the real design system, EN/AR catalogs, project query, config mutation and shared upload hook, in an editor-canvas frame; fictional site and fictional local SVG; project GET, config PATCH (one-level branding merge like the API) and upload presign/PUT/confirm answered by interception; not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/components/project-settings/branding-section.tsx'],
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
