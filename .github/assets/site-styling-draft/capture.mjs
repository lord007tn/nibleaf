// Isolated component fixture of Site configuration → Styling: main's section
// (before) and this branch's (after, through its compatibility re-export) with
// the real design system, EN/AR catalogs, project query and save mutation,
// given a fictional site. Every request is answered by interception on the
// fixture origin. Not the signed-in dashboard and not production. No server starts.
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
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
/** A message by its id as the code names it (`settings.styling.hue`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://styling.fixture.test';
/** The fictional site's stored styling: a color and the Theme section's appearance; no radius stored. */
const savedStyling = { primaryColor: '#5546e8', theme: 'dark' };
const BASE = 'origin/main';

let harness;
try {
  harness = await mkdtemp(resolve(app, '.styling-capture-'));
  // Main's section, its sibling import pointed at the shared module it used.
  await writeFile(
    resolve(harness, 'before-section.tsx'),
    git('show', `${BASE}:apps/app/src/components/project-settings/styling-section.tsx`).replace(
      "from './shared'",
      "from '@/components/project-settings/shared'",
    ),
  );
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
import { StylingSection as After } from '@/components/project-settings/styling-section';
import { useProject } from '@/hooks/api';
import { StylingSection as Before } from './before-section';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
const Section = params.get('version') === 'before' ? Before : After;

/** The editor's Configuration canvas: the site from the project query, then the section, keyed by site as the host does. */
function Canvas() {
  const { data: project } = useProject('site-1');
  return project ? <Section key={project.id} project={project} /> : null;
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
   * `config.styling` key by key and keeps every other section. That is a
   * stand-in for the API: apps/server/src/actions/projects.test.ts runs the
   * real validator and merge.
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
      config: { theme: { preset: 'harbor' }, seo: { metaTitle: 'Handbook Docs' }, styling: { ...server.styling } },
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
    await hex(page, locale).waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const hex = (page, locale) => page.getByRole('textbox', { name: msg(locale, 'settings.styling.primaryColor.label'), exact: true });
  const slider = (page, locale, name) => page.getByRole('slider', { name: msg(locale, `settings.styling.${name}`), exact: true });
  const button = (page, name) => page.getByRole('button', { name, exact: true });
  /** What a reviewer should see: the controls, the problem, toasts, the save bar and its status. */
  const state = async (page, locale) => ({
    dir: await page.evaluate(() => document.documentElement.dir),
    hex: await hex(page, locale).inputValue(),
    hexDir: await hex(page, locale).getAttribute('dir'),
    invalid: (await hex(page, locale).getAttribute('aria-invalid')) === 'true',
    describedBy: await hex(page, locale).evaluate((el) => {
      const id = el.getAttribute('aria-describedby');
      return id ? (document.getElementById(id)?.textContent ?? null) : null;
    }),
    hsl: await Promise.all(['hue', 'saturation', 'lightness'].map((name) => slider(page, locale, name).inputValue())),
    radius: await page.evaluate(
      (labels) =>
        [...document.querySelectorAll('button[aria-pressed="true"]')].map((el) => el.textContent?.trim()).find((text) => labels.includes(text)) ??
        null,
      ['sharp', 'rounded', 'pill'].map((name) => msg(locale, `settings.styling.radius.${name}`)),
    ),
    toasts: await page.locator('[data-sonner-toast]').allInnerTexts(),
    saveButtonVisible: await page.getByRole('button', { name: msg(locale, 'common.save'), exact: true }).isVisible(),
    // The bar's polite status stays mounted (visually hidden) when the bar hides.
    status: await page.evaluate(() => document.querySelector('div.sr-only[role="status"][aria-live="polite"]')?.textContent?.trim() ?? ''),
    focusedIsHex: await hex(page, locale).evaluate((el) => document.activeElement === el),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  });

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    // One still per locale and width: main's section beside this branch's, the
    // same unsaved draft in both (Pill chosen, a partial "#12" typed and left).
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390]) {
        const shots = {};
        const seenBy = {};
        for (const version of ['before', 'after']) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
          const { page, errors, requests } = await open(context, { locale, version });
          await button(page, msg(locale, 'settings.styling.radius.pill')).click();
          await hex(page, locale).fill('#12');
          await hex(page, locale).blur();
          await page.waitForTimeout(300);
          await page.mouse.move(0, 0);
          const seen = await state(page, locale);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.hexDir, 'ltr');
          assert.equal(seen.overflow, false);
          assert.deepEqual(errors, []);
          assert.ok(!requests.some(({ call }) => call.startsWith('PATCH')), 'nothing is saved in a still capture');
          if (version === 'after') {
            assert.equal(seen.invalid, true);
            assert.equal(seen.describedBy, msg(locale, 'settings.styling.invalidHex'));
          }
          shots[version] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          seenBy[version] = { ...seen, requests: requests.map(({ call }) => call), pageErrors: errors };
          await context.close();
        }
        const file = `invalid-hex-${locale}-${width}.png`;
        const narrow = width < 800;
        const sheet = await browser.newContext({ viewport: { width: narrow ? width * 2 + 48 : width + 32, height: 600 }, deviceScaleFactor: 1 });
        const sheetPage = await sheet.newPage();
        const panel = (version, label) =>
          `<figure style="margin:0"><figcaption style="margin-bottom:6px"><b>${label}</b></figcaption><img src="data:image/png;base64,${shots[version].toString('base64')}" width="${width}"></figure>`;
        await sheetPage.setContent(
          `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Styling section · ${locale.toUpperCase()} · ${width}px · unsaved draft: Pill chosen, “#12” typed and the field left</div>
<div style="display:flex;flex-direction:${narrow ? 'row' : 'column'};gap:16px">${panel('before', `Before (${BASE}): no problem shown until a save toast`)}${panel('after', 'After (this branch): the problem on the field, the page’s save bar')}</div></body>`,
        );
        await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
        await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true });
        await sheet.close();
        captures.push({ file, locale, width, theme: 'light', before: seenBy.before, after: seenBy.after });
      }

    // Preset → slider (keyboard) → invalid hex → save refused → fixed and saved → Discard → a failed save.
    const locale = 'en';
    const width = 1440;
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 860 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 860 } },
    });
    const { page, errors, requests, server } = await open(context, { locale, version: 'after' });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) =>
      steps.push({ step, ...(await state(page, locale)), requestsSoFar: requests.length, server: { styling: { ...server.styling } } });
    const save = () => page.getByRole('button', { name: msg(locale, 'common.save'), exact: true }).click();
    await pause();
    await note('opened: pristine, no save bar');

    await button(page, '#16a34a').click();
    await pause(400);
    await note('picked the green preset: the sliders follow it');
    await slider(page, locale, 'hue').focus();
    for (let step = 0; step < 20; step += 1) await page.keyboard.press('ArrowRight');
    await pause(400);
    await note('moved the hue slider 20 steps with the keyboard');

    await hex(page, locale).fill('#12');
    await pause(300);
    await note('typed a partial "#12": nothing shown while typing');
    await hex(page, locale).blur();
    await pause(300);
    await note('left the field: the problem shows on it');
    await save();
    await pause(500);
    await note('Save: refused, the field focused, nothing sent');

    await hex(page, locale).fill('#0ea');
    await pause(300);
    await note('typed the short "#0ea": the problem clears');
    server.saveDelay = 900;
    await save();
    await pause(300);
    await note('Save pressed: saving');
    await pause(1600);
    await note('saved and refetched: "#00eeaa" alone was sent; the appearance kept');

    await button(page, msg(locale, 'settings.styling.radius.pill')).click();
    await pause(400);
    await note('chose Pill');
    await page.getByRole('button', { name: msg(locale, 'forms.discard'), exact: true }).click();
    await pause(400);
    await note('Discard: back to the stored radius (unset, shown as Rounded)');

    server.failNext = true;
    server.saveDelay = 400;
    await button(page, '#db2777').click();
    await save();
    await pause(1400);
    await note('a save the server refuses: one error, the edit kept');

    const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    assert.equal(patches.length, 2);
    assert.deepEqual(patches[0].body, { config: { styling: { primaryColor: '#00eeaa' } } });
    assert.deepEqual(patches[1].body, { config: { styling: { primaryColor: '#db2777' } } });
    assert.equal(at('typed a partial').invalid, false);
    assert.equal(at('left the field').invalid, true);
    assert.equal(at('Save: refused').focusedIsHex, true);
    assert.equal(at('Save: refused').status, msg(locale, 'forms.fixHighlighted'));
    assert.equal(at('typed the short').hex, '#0EA');
    assert.equal(at('typed the short').invalid, false);
    assert.equal(at('saved and refetched').saveButtonVisible, false);
    assert.equal(at('saved and refetched').hex, '#00EEAA');
    assert.deepEqual(at('saved and refetched').server.styling, { primaryColor: '#00eeaa', theme: 'dark' });
    assert.equal(at('Discard').radius, msg(locale, 'settings.styling.radius.rounded'));
    assert.equal(at('Discard').saveButtonVisible, false);
    assert.equal(steps.at(-1).toasts.length, 1);
    assert.equal(steps.at(-1).hex, '#DB2777');
    assert.equal(steps.at(-1).saveButtonVisible, true);
    assert.deepEqual(steps.at(-1).server.styling, { primaryColor: '#00eeaa', theme: 'dark' });
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's Styling section (${BASE}) and this branch's (features/site-styling, through its compatibility re-export) with the real design system, EN/AR catalogs, project query and save mutation, in an editor-canvas frame; fictional site; GETs and PATCHes answered by interception; not the signed-in dashboard or production`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} before/after pairs and ${recordings.length} recording; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
}
