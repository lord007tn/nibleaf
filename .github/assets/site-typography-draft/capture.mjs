// Isolated component fixture of Site configuration → Typography: the real
// section (before: the main-branch component; after: features/site-typography)
// with the real design system, EN/AR catalogs, project query and config
// mutation, given a fictional site. The project GET (from an in-page store) and
// the config PATCH (merged one level deep as the API does) are answered by
// interception on the fixture origin. Not the signed-in dashboard and not
// production. No server starts, and no font is fetched from anywhere.
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
const beforeSource = git('show', `${baseline}:apps/app/src/components/project-settings/typography-section.tsx`).replace(
  "from './shared'",
  "from '@/components/project-settings/shared'",
);
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://typography.fixture.test';
/** The fictional site's saved typography: the Compact rhythm and a heading font outside the catalog. */
const savedTypography = { headingFont: 'Merriweather', bodyFont: 'Inter', codeFont: 'Fira Code', baseSize: '15', leading: '1.6', flow: '1' };
/** Another config section, which a typography save must leave as it is. */
const savedBranding = { favicon: '/favicon.svg' };

const lock = await acquireDevstackLock('site typography draft captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.typography-capture-'));
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@import "../src/typeset.css";\n@source "./";\n@source "../src/features/site-typography";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../src/components/ui";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { TypographySettings } from '@/features/site-typography/components/typography-settings';
import { useProject } from '@/hooks/api';
import { TypographySection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.add(theme);
const Section = params.get('phase') === 'before' ? BeforeSection : TypographySettings;
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

  /** Opens the fixture over an in-page store of the site; `server.saveDelay` holds the PATCH. */
  async function open(context, { phase, locale, theme }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { typography: { ...savedTypography }, branding: { ...savedBranding }, saveDelay: 0 };
    const project = () => ({
      id: 'site-1',
      name: 'Handbook',
      slug: 'handbook',
      config: { theme: { preset: 'nib' }, branding: { ...server.branding }, typography: { ...server.typography } },
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
        server.typography = { ...server.typography, ...body.config.typography };
        if (body.config.branding) server.branding = { ...server.branding, ...body.config.branding };
        return json(route, { data: project() });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}&theme=${theme}`);
    await page.locator('.typeset').waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const msg = (locale, key) => catalogs[locale][key.replaceAll('.', '_').toLowerCase()];
  const saveButton = (page, locale) => page.getByRole('button', { name: catalogs[locale].common_save, exact: true });
  /** The "after" form's labelled groups (main's form has none). */
  const groupButton = (page, locale, labelKey, name) =>
    page.getByRole('group', { name: msg(locale, labelKey), exact: true }).getByRole('button', { name, exact: true });
  /** What a reviewer should see: the pickers, the pressed buttons, the preview's variables and whether a Save button shows. */
  const state = async (page, locale) => ({
    dir: await page.evaluate(() => document.documentElement.dir),
    fonts: await page.locator('[data-slot="select-value"]').allInnerTexts(),
    pressed: await page.locator('[aria-pressed="true"]').allInnerTexts(),
    preview: await page
      .locator('.typeset')
      .evaluate((el) =>
        Object.fromEntries(
          ['font-size', '--typeset-leading', '--typeset-flow', '--typeset-font-heading'].map((name) => [
            name,
            name.startsWith('--') ? el.style.getPropertyValue(name) : el.style.fontSize,
          ]),
        ),
      ),
    toasts: await page.locator('[data-sonner-toast]').allInnerTexts(),
    saveButtonVisible: await saveButton(page, locale).isVisible(),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  });

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390])
        for (const phase of ['before', 'after']) {
          const shots = {};
          const themes = {};
          for (const theme of ['light', 'dark']) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: theme });
            const { page, errors, requests } = await open(context, { phase, locale, theme });
            await page.mouse.move(0, 0);
            const seen = { ...(await state(page, locale)), requests, pageErrors: errors };
            assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(seen.overflow, false);
            assert.deepEqual(errors, []);
            shots[theme] = await page.screenshot({ fullPage: true, animations: 'disabled' });
            themes[theme] = seen;
            await context.close();
          }
          const file = `pristine-${phase}-${locale}-${width}.png`;
          // Light and dark side by side under a caption that says what this is.
          const sheet = await browser.newContext({ viewport: { width: width * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
          const sheetPage = await sheet.newPage();
          const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
          await sheetPage.setContent(
            `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Typography section · ${phase} · saved values · ${locale.toUpperCase()} · ${width}px</div>
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
          captures.push({ file, phase, locale, width, themes: ['light', 'dark'], ...seen, pageErrors });
        }

    // The new form in use: preset → one manual adjustment → Save → refetch, read back step by step.
    const locale = 'en';
    const width = 1440;
    const file = `flow-after-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 1000 } },
    });
    const { page, errors, requests, server } = await open(context, { phase: 'after', locale, theme: 'light' });
    const pause = (ms = 900) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page, locale)) });
    await pause();
    await note('opened: the saved values, Compact pressed (it matches 15 / 1.6 / Snug), no save bar');

    await groupButton(page, locale, 'settings.typography.preset.label', msg(locale, 'settings.typography.preset.article')).click();
    await pause();
    await note('Article preset: only size, line height and block spacing change; the preview follows; nothing is saved');

    await groupButton(page, locale, 'settings.typography.leading.label', '1.9').click();
    await pause();
    await note('line height set to 1.9 by hand: no preset is pressed any more; the preview follows');

    server.saveDelay = 900;
    await saveButton(page, locale).click();
    await pause(300);
    await note('Save pressed: saving');
    await pause(1600);
    await note('saved and refetched: the form shows what the server holds, no save bar');

    assert.deepEqual(errors, []);
    const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0].body, { config: { typography: { baseSize: '17', leading: '1.9', flow: '1.5' } } });
    assert.deepEqual(server.branding, savedBranding);
    assert.deepEqual(server.typography, { ...savedTypography, baseSize: '17', leading: '1.9', flow: '1.5' });
    assert.ok(steps[0].pressed.includes(msg(locale, 'settings.typography.preset.compact')));
    assert.ok(steps[1].pressed.includes(msg(locale, 'settings.typography.preset.article')));
    assert.deepEqual(steps[1].preview, {
      'font-size': '17px',
      '--typeset-leading': '2',
      '--typeset-flow': '1.5em',
      '--typeset-font-heading': steps[0].preview['--typeset-font-heading'],
    });
    assert.ok(
      !steps[2].pressed.some((name) =>
        Object.keys(catalogs.en).some((key) => key.startsWith('settings_typography_preset_') && catalogs.en[key] === name),
      ),
    );
    assert.equal(steps[2].preview['--typeset-leading'], '1.9');
    assert.equal(steps[1].saveButtonVisible, true);
    assert.equal(steps[4].saveButtonVisible, false);
    assert.deepEqual(steps[4].fonts, ['Merriweather', 'Inter', 'Fira Code']);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({
      file,
      locale,
      width,
      theme: 'light',
      requests,
      serverAfter: { typography: server.typography, branding: server.branding },
      pageErrors: errors,
      steps,
    });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real Typography section (before: main; after: this branch) with the real design system, typeset CSS, EN/AR catalogs, project query and config mutation, in an editor-canvas frame; fictional site; project GET and config PATCH (one-level merge like the API) answered by interception; not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/components/project-settings/typography-section.tsx'],
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
  await lock.release();
}
