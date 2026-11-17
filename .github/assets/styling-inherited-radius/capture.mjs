// Isolated component fixture of Site configuration → Styling's corner radius:
// main's Styling feature (before) and this branch's (after) with the real
// design system, EN/AR catalogs, project query and save mutation, given a
// fictional Signal site with no stored radius. Every request is answered by
// interception on the fixture origin. Not the signed-in dashboard and not
// production. No server starts.
//
// Run it while holding the repository's heavy-step lock; it takes no lock itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
/** A message by its id as the code names it (`settings.styling.radius.sharp`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://styling.fixture.test';
/** The fictional site: the Signal theme (its preset radius is Sharp), a stored color and appearance, no stored radius. */
const THEME = { preset: 'signal' };
const savedStyling = { primaryColor: '#5546e8', theme: 'dark' };
const BASE = 'origin/main';
const FEATURE = 'apps/app/src/features/site-styling';

let harness;
try {
  harness = await mkdtemp(resolve(app, '.radius-capture-'));
  // Main's feature as it is on the base: component, model and save hook, with their relative imports intact.
  for (const file of ['components/styling-settings.tsx', 'model/styling.ts', 'api/hooks.ts']) {
    await mkdir(resolve(harness, 'before', file, '..'), { recursive: true });
    await writeFile(resolve(harness, 'before', file), git('show', `${BASE}:${FEATURE}/${file}`));
  }
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-styling";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { StylingSettings as After } from '@/features/site-styling/components/styling-settings';
import { useProject } from '@/hooks/api';
import { StylingSettings as Before } from './before/components/styling-settings';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
const Section = params.get('version') === 'before' ? Before : After;

/** The editor's Configuration canvas: the site from the project query, then the section. */
function Canvas() {
  const { data: project } = useProject('site-1');
  return project ? <Section project={project} /> : null;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
      <main className="mx-auto w-full max-w-4xl px-5 pt-7 pb-32 text-foreground sm:px-8"><Canvas /></main>
    </DirectionProvider>
    <Toaster theme="light" />
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
   * Opens the fixture over an in-page store. `server.saveDelay` holds each
   * PATCH; `server.failNext` answers the next one 503. A PATCH merges
   * `config.styling` key by key and keeps every other section: a stand-in for
   * the API, whose real validator and merge apps/server/src/actions/projects.test.ts runs.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { styling: { ...savedStyling }, saveDelay: 0, failNext: false };
    const project = () => ({
      id: 'site-1',
      name: 'Handbook',
      description: 'Guides for the Handbook team.',
      slug: 'handbook',
      config: { theme: { ...THEME }, seo: { metaTitle: 'Handbook Docs' }, styling: { ...server.styling } },
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
        if (server.failNext) {
          server.failNext = false;
          return json(route, { error: { message: 'Service unavailable' } }, 503);
        }
        server.styling = { ...server.styling, ...body.config.styling };
        return json(route, { data: project() });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await radiusButton(page, locale, 'sharp').waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const radiusButton = (page, locale, name) => page.getByRole('button', { name: msg(locale, `settings.styling.radius.${name}`), exact: true });
  const saveButton = (page, locale) => page.getByRole('button', { name: msg(locale, 'common.save'), exact: true });
  /** What a reviewer should see: the pressed radius, its group's name and description, toasts, the save bar and its status. */
  const state = async (page, locale) => ({
    dir: await page.evaluate(() => document.documentElement.dir),
    radius: await page.evaluate(
      (labels) =>
        [...document.querySelectorAll('button[aria-pressed="true"]')].map((el) => el.textContent?.trim()).find((text) => labels.includes(text)) ??
        null,
      ['sharp', 'rounded', 'pill'].map((name) => msg(locale, `settings.styling.radius.${name}`)),
    ),
    disabledRadii: await page.evaluate(() => document.querySelectorAll('[data-slot="segmented-control-item"]:disabled').length),
    group: await page.evaluate(() => {
      const group = document.querySelector('fieldset[aria-describedby]');
      if (!group) return null;
      const text = (attribute) => document.getElementById(group.getAttribute(attribute) ?? '')?.textContent ?? null;
      return { name: text('aria-labelledby'), description: text('aria-describedby') };
    }),
    toasts: await page.locator('[data-sonner-toast]').allInnerTexts(),
    saveButtonVisible: await saveButton(page, locale).isVisible(),
    // The bar's polite status stays mounted (visually hidden) when the bar hides.
    status: await page.evaluate(() => document.querySelector('div.sr-only[role="status"][aria-live="polite"]')?.textContent?.trim() ?? ''),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  });

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    // Per locale and width: main as opened, this branch as opened (inherited
    // Sharp), and this branch after one click on Rounded and one save.
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390]) {
        const shots = {};
        const seenBy = {};
        const shoot = async (key, page, requests, errors) => {
          await page.mouse.move(0, 0);
          await page.waitForTimeout(300);
          const seen = await state(page, locale);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.overflow, false);
          assert.deepEqual(errors, []);
          shots[key] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          seenBy[key] = { ...seen, requests: requests.map(({ call, body }) => (body ? { call, body } : call)), pageErrors: [...errors] };
          return seen;
        };
        const newContext = () => browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });

        let context = await newContext();
        let opened = await open(context, { locale, version: 'before' });
        const before = await shoot('before', opened.page, opened.requests, opened.errors);
        assert.equal(before.radius, msg(locale, 'settings.styling.radius.rounded'), 'main shows Rounded for an unset radius');
        // Main's limitation: a click on the Rounded it shows registers nothing, so one save can't store it.
        await radiusButton(opened.page, locale, 'rounded').click();
        await opened.page.waitForTimeout(300);
        seenBy.beforeRoundedClick = { saveButtonVisible: await saveButton(opened.page, locale).isVisible() };
        assert.equal(seenBy.beforeRoundedClick.saveButtonVisible, false);
        await context.close();

        context = await newContext();
        opened = await open(context, { locale, version: 'after' });
        const inherited = await shoot('inherited', opened.page, opened.requests, opened.errors);
        assert.equal(inherited.radius, msg(locale, 'settings.styling.radius.sharp'));
        assert.deepEqual(inherited.group, {
          name: msg(locale, 'settings.styling.radius.label'),
          description: msg(locale, 'settings.styling.radius.inherited'),
        });
        assert.equal(inherited.disabledRadii, 0);
        assert.equal(inherited.saveButtonVisible, false);
        await radiusButton(opened.page, locale, 'rounded').click();
        await saveButton(opened.page, locale).click();
        await opened.page.waitForFunction(() => !document.querySelector('[data-slot="save-region"]'));
        const override = await shoot('override', opened.page, opened.requests, opened.errors);
        const patches = opened.requests.filter(({ call }) => call.startsWith('PATCH'));
        assert.deepEqual(
          patches.map(({ body }) => body),
          [{ config: { styling: { radius: 'rounded' } } }],
        );
        assert.deepEqual(opened.server.styling, { ...savedStyling, radius: 'rounded' });
        assert.equal(override.radius, msg(locale, 'settings.styling.radius.rounded'));
        assert.equal(override.group.description, msg(locale, 'settings.styling.radius.override'));
        assert.equal(override.saveButtonVisible, false);
        seenBy.override.server = { styling: { ...opened.server.styling } };
        await context.close();

        const file = `radius-${locale}-${width}.png`;
        const narrow = width < 800;
        const sheet = await browser.newContext({ viewport: { width: narrow ? width * 3 + 64 : width + 32, height: 600 }, deviceScaleFactor: 1 });
        const sheetPage = await sheet.newPage();
        const panel = (key, label) =>
          `<figure style="margin:0"><figcaption style="margin-bottom:6px"><b>${label}</b></figcaption><img src="data:image/png;base64,${shots[key].toString('base64')}" width="${width}"></figure>`;
        await sheetPage.setContent(
          `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Styling · ${locale.toUpperCase()} · ${width}px · fictional site on the Signal theme (its radius: Sharp), no stored radius</div>
<div style="display:flex;flex-direction:${narrow ? 'row' : 'column'};gap:16px">${panel('before', `Before (${BASE}): shows Rounded; the site draws Sharp`)}${panel('inherited', 'After, opened: Sharp, inherited from the theme')}${panel('override', 'After one click on Rounded and one save: the site’s own')}</div></body>`,
        );
        await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
        await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
        await sheet.close();
        captures.push({ file, locale, width, theme: 'light', ...seenBy });
      }

    // Keyboard pin of the inherited option → Discard → a refused save → the retry.
    const locale = 'en';
    const width = 1440;
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 760 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 760 } },
    });
    const { page, errors, requests, server } = await open(context, { locale, version: 'after' });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) =>
      steps.push({ step, ...(await state(page, locale)), requestsSoFar: requests.length, server: { styling: { ...server.styling } } });
    await pause();
    await note('opened: Sharp, inherited from Signal; no save bar');

    await radiusButton(page, locale, 'sharp').focus();
    await page.keyboard.press('Space');
    await pause(500);
    await note('Space on the already-pressed Sharp: set for this site, to save');
    await page.getByRole('button', { name: msg(locale, 'forms.discard'), exact: true }).click();
    await pause(500);
    await note('Discard: inherited again');

    server.failNext = true;
    server.saveDelay = 400;
    await radiusButton(page, locale, 'rounded').click();
    await pause(400);
    await note('clicked Rounded');
    await saveButton(page, locale).click();
    await pause(1400);
    await note('a save the server refuses: one error, Rounded kept as the site’s own');

    server.saveDelay = 600;
    await saveButton(page, locale).click();
    await pause(1600);
    await note('the retry: saved, Rounded is the site’s own');

    const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    assert.deepEqual(
      patches.map(({ body }) => body),
      [{ config: { styling: { radius: 'rounded' } } }, { config: { styling: { radius: 'rounded' } } }],
    );
    assert.equal(at('opened').group.description, msg(locale, 'settings.styling.radius.inherited'));
    assert.equal(at('Space').radius, msg(locale, 'settings.styling.radius.sharp'));
    assert.equal(at('Space').group.description, msg(locale, 'settings.styling.radius.override'));
    assert.equal(at('Space').saveButtonVisible, true);
    assert.equal(at('Discard').group.description, msg(locale, 'settings.styling.radius.inherited'));
    assert.equal(at('Discard').saveButtonVisible, false);
    assert.equal(at('a save the server refuses').toasts.length, 1);
    assert.equal(at('a save the server refuses').radius, msg(locale, 'settings.styling.radius.rounded'));
    assert.equal(at('a save the server refuses').saveButtonVisible, true);
    assert.deepEqual(at('a save the server refuses').server.styling, savedStyling);
    assert.equal(at('the retry').saveButtonVisible, false);
    assert.equal(at('the retry').group.description, msg(locale, 'settings.styling.radius.override'));
    assert.deepEqual(at('the retry').server.styling, { ...savedStyling, radius: 'rounded' });
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's Styling feature (${BASE}) and this branch's with the real design system, EN/AR catalogs, project query and save mutation, in an editor-canvas frame; fictional Signal site; GETs and PATCHes answered by interception; not the signed-in dashboard or production`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} before/after sheets and ${recordings.length} recording; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
}
