// Isolated component fixture of Site configuration → SEO: the real section
// (before: the main-branch component; after: features/site-seo) with the real
// design system, EN/AR catalogs, project and language queries, both save
// mutations and the shared upload hook, given a fictional site with an Arabic
// language and a fictional local PNG. Every request is answered by
// interception on the fixture origin. Not the signed-in dashboard and not
// production. No server starts and nothing is uploaded.
//
// Run it while holding the repository's heavy-step lock; it takes no lock itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
const beforeSource = git('show', `${baseline}:apps/app/src/components/project-settings/seo-section.tsx`).replace(
  "from './shared'",
  "from '@/components/project-settings/shared'",
);
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://seo.fixture.test';
const savedSeo = { metaTitle: 'Handbook Docs', metaDescription: 'Everything the Handbook team writes down.', socialImage: '/og/cover.png' };
/** The Arabic language's stored config: a banner override (another form's) and no SEO yet. */
const arabicConfig = { banner: { message: 'إعلان تجريبي' } };
// A 1×1 PNG.
const fictionalPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let harness;
try {
  harness = await mkdtemp(resolve(app, '.seo-capture-'));
  const imageFile = resolve(harness, 'handbook-cover.png');
  await writeFile(imageFile, fictionalPng);
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-seo";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../src/components/ui";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { SeoSettings } from '@/features/site-seo/components/seo-settings';
import { useProject } from '@/hooks/api';
import { SeoSection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.add(theme);
const Section = params.get('phase') === 'before' ? BeforeSection : SeoSettings;
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });

/** The editor's Configuration canvas: the site from the project query, then the section, keyed by site as the host does. */
function Canvas() {
  const { data: project } = useProject('site-1');
  return project ? <Section key={project.id} project={project} /> : null;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <main className="mx-auto w-full max-w-4xl px-5 pt-7 pb-32 text-foreground sm:px-8"><Canvas /></main>
    </ConfirmProvider>
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
   * Opens the fixture over an in-page store. `server.confirmDelay` holds the
   * upload's confirm and `server.saveDelay` each PATCH. A project PATCH merges
   * `config.seo` key by key; a language PATCH does the same, and `config: null`
   * drops the language's SEO and keeps its banner. That is a stand-in for the
   * API: `apps/server/src/actions/{projects,languages.writes}.test.ts` run the
   * real merges.
   */
  async function open(context, { phase, locale, theme }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { seo: { ...savedSeo }, arabic: structuredClone(arabicConfig), confirmDelay: 0, saveDelay: 0, uploads: 0 };
    const project = () => ({
      id: 'site-1',
      name: 'Handbook',
      description: 'Guides for the Handbook team.',
      slug: 'handbook',
      config: { theme: { preset: 'nib' }, seo: { ...server.seo } },
    });
    const languages = () => [
      { id: 'en', projectId: 'site-1', code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, position: 0, config: null },
      {
        id: 'ar',
        projectId: 'site-1',
        code: 'ar',
        label: 'العربية',
        direction: 'RTL',
        isDefault: false,
        enabled: true,
        position: 1,
        config: structuredClone(server.arabic),
      },
    ];
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
      if (call === 'GET /api/app/projects/site-1/languages') {
        requests.push({ call });
        return json(route, { data: languages() });
      }
      if (call === 'PATCH /api/app/projects/site-1') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        await wait(server.saveDelay);
        server.seo = { ...server.seo, ...body.config.seo };
        return json(route, { data: project() });
      }
      if (call === 'PATCH /api/app/projects/site-1/languages/ar') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        await wait(server.saveDelay);
        const { seo: _dropped, ...chrome } = server.arabic ?? {};
        server.arabic = body.config === null ? chrome : { ...server.arabic, seo: { ...server.arabic?.seo, ...body.config.seo } };
        return json(route, { data: languages()[1] });
      }
      if (call === 'POST /api/app/projects/site-1/assets/presign') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        server.uploads += 1;
        const key = `site-1/seo/${server.uploads}-${body.filename}`;
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
    await text(page, locale, 'metaTitle').waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const LABELS = {
    metaTitle: 'settings_seo_metatitle_label',
    metaDescription: 'settings_seo_metadescription_label',
    socialImage: 'settings_seo_socialimage_label',
  };
  const text = (page, locale, name) => page.getByRole('textbox', { name: catalogs[locale][LABELS[name]], exact: true });
  const indexSwitch = (page, locale) => page.getByRole('switch', { name: catalogs[locale].settings_seo_allowindex_title, exact: true });
  const uploadControl = (page, locale) => text(page, locale, 'socialImage').locator('xpath=..');
  const choose = (page, locale) => uploadControl(page, locale).locator('input[type="file"]').setInputFiles(imageFile);
  const scope = (page, label) => page.getByRole('button', { name: label });
  const saveButton = (page, locale) => page.getByRole('button', { name: catalogs[locale].common_save, exact: true });
  /** What a reviewer should see: values, directions, placeholders, upload progress, toasts, the save bar and its status. */
  const state = async (page, locale) => {
    const names = Object.keys(LABELS);
    const read = async (fn) => Object.fromEntries(await Promise.all(names.map(async (name) => [name, await fn(text(page, locale, name))])));
    return {
      dir: await page.evaluate(() => document.documentElement.dir),
      fields: { ...(await read((el) => el.inputValue())), allowIndex: (await indexSwitch(page, locale).getAttribute('aria-checked')) === 'true' },
      fieldDir: await read((el) => el.getAttribute('dir')),
      placeholders: await read((el) => el.getAttribute('placeholder')),
      uploading: (await uploadControl(page, locale).getByRole('button').getAttribute('aria-busy')) === 'true',
      toasts: await page.locator('[data-sonner-toast]').allInnerTexts(),
      saveButtonVisible: await saveButton(page, locale).isVisible(),
      // The bar's polite status stays mounted (visually hidden) when the bar hides.
      status: await page.evaluate(() => document.querySelector('div.sr-only[role="status"][aria-live="polite"]')?.textContent?.trim() ?? ''),
      overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    };
  };

  // Each scene: what the person does before the capture.
  const scenes = {
    pristine: { phases: ['before', 'after'], act: async () => undefined },
    'arabic-draft': {
      phases: ['after'],
      act: async (page, locale) => {
        await scope(page, 'العربية').click();
        await choose(page, locale);
        await page.waitForFunction(() => document.querySelector('input[dir="ltr"][inputmode="url"]')?.value.startsWith('http'));
        await text(page, locale, 'metaTitle').fill('دليل فريق هاندبوك');
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
              assert.equal(seen.fieldDir.socialImage, 'ltr');
              assert.ok(!requests.some(({ call }) => call.startsWith('PATCH')), 'nothing is saved in a still capture');
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
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · SEO section · ${phase} · ${scene} · ${locale.toUpperCase()} · ${width}px</div>
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
            const { pageErrors, requests, ...seen } = themes.light;
            captures.push({
              file,
              phase,
              scene,
              locale,
              width,
              themes: ['light', 'dark'],
              ...seen,
              requests: requests.map(({ call }) => call),
              pageErrors,
            });
          }

    // The new form in use: an upload left behind by a scope switch, then upload → edit → Save → refetch in the
    // Arabic scope, then clearing it back to the project's SEO. Read back step by step.
    const locale = 'en';
    const width = 1440;
    const file = `flow-after-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 860 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 860 } },
    });
    const { page, errors, requests, server } = await open(context, { phase: 'after', locale, theme: 'light' });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) =>
      steps.push({
        step,
        ...(await state(page, locale)),
        requestsSoFar: requests.length,
        server: { seo: { ...server.seo }, arabic: structuredClone(server.arabic) },
      });
    await pause();
    await note('opened: Default scope, pristine, no save bar');

    server.confirmDelay = 1800;
    await choose(page, locale);
    await pause(300);
    await note('chose an image in the Default scope: the Upload button shows progress');
    await scope(page, 'العربية').click();
    await pause(300);
    await note('switched to the Arabic scope while that upload runs (clean, so no confirmation)');
    await pause(1900);
    await note('the Default-scope upload finished: it did not fill the Arabic draft, nothing is unsaved');

    server.confirmDelay = 600;
    await choose(page, locale);
    await pause(1200);
    await note('uploaded in the Arabic scope: the URL fills the draft only, no PATCH');
    await text(page, locale, 'metaTitle').fill('دليل فريق هاندبوك');
    await pause(300);
    await note('typed an Arabic title');

    server.saveDelay = 900;
    await saveButton(page, locale).click();
    await pause(300);
    await note('Save pressed: saving');
    await pause(1600);
    await note('saved and refetched: the Arabic SEO is stored, its banner kept, the form clean');

    await text(page, locale, 'metaTitle').fill('');
    await text(page, locale, 'socialImage').fill('');
    await pause(300);
    await saveButton(page, locale).click();
    await pause(1600);
    await note('cleared both and saved: config null, the Arabic SEO is gone and its banner kept');

    await scope(page, /English/).click();
    await pause();
    await note('back to Default: the project SEO is unchanged');

    const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    assert.equal(at('the Default-scope upload finished').fields.socialImage, '');
    assert.equal(at('the Default-scope upload finished').saveButtonVisible, false);
    assert.equal(new URL(at('uploaded in the Arabic scope').fields.socialImage).origin, origin);
    assert.equal(patches.length, 2);
    assert.equal(patches[0].call, 'PATCH /api/app/projects/site-1/languages/ar');
    assert.deepEqual(patches[0].body.config.seo.metaTitle, 'دليل فريق هاندبوك');
    assert.deepEqual(patches[1].body, { config: null });
    assert.equal(at('saved and refetched').saveButtonVisible, false);
    assert.equal(at('saved and refetched').status, catalogs[locale].common_saved);
    assert.deepEqual(at('saved and refetched').server.arabic.banner, arabicConfig.banner);
    assert.deepEqual(at('cleared both').server.arabic, arabicConfig);
    assert.deepEqual(steps.at(-1).fields, { ...savedSeo, allowIndex: true });
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real SEO section (before: main; after: this branch) with the real design system, EN/AR catalogs, project and language queries, both save mutations and the shared upload hook, in an editor-canvas frame; fictional site, Arabic language and local PNG; GETs, PATCHes and upload presign/PUT/confirm answered by interception; not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/components/project-settings/seo-section.tsx'],
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} captures and ${recordings.length} recording; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
}
