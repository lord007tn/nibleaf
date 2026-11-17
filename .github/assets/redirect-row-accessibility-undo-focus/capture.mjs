// Isolated component fixture for #751: Site configuration → Redirects with the
// real Sonner toast. The real section (before: main's component at the merge
// base; after: this branch) with the real design system, EN/AR catalogs,
// project query, config mutation and the design-system Toaster (placed as the
// dashboard places it), given fictional sites with fictional public rules.
// The project GET and config PATCH are answered by interception on the fixture
// origin. Not the signed-in dashboard, not production; no redirect is followed
// and no server starts.
//
// Accessible names are Chrome's own (`Element.computedName`, behind the
// ComputedAccessibilityInfo Blink feature), not a JavaScript re-implementation.
// Each step waits on a real signal (a toast attached or detached, a request
// seen); the only fixed pauses are for the viewer of the recording.
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
const out = import.meta.dirname;
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
const componentPath = 'apps/app/src/features/site-redirects/components/redirects-settings.tsx';
const beforeSource = git('show', `${baseline}:${componentPath}`)
  .replace("from '../api/hooks'", "from '@/features/site-redirects/api/hooks'")
  .replace("from '../model/redirects'", "from '@/features/site-redirects/model/redirects'");
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://redirects-a11y.fixture.test';
/** Fictional sites. Handbook's rules mix directions: Latin paths, an Arabic one, an external URL. */
const SITES = {
  'site-1': {
    name: 'Handbook',
    redirects: [
      { from: '/guides/install', to: '/get-started/install', generated: true },
      { from: '/legacy', to: 'https://archive.example.com/docs?ref=handbook#top', generated: false },
      { from: '/دليل', to: '/ar/guide?lang=ar', generated: false },
      { from: '/api/v1', to: '/reference/api#v1', generated: false },
    ],
  },
  'site-2': { name: 'Atlas', redirects: [{ from: '/team', to: '/people', generated: false }] },
};

// REPRO=1 runs main's component only (names and focus journeys) into repro-main.json, before any fix.
const repro = process.env.REPRO === '1';
const phases = repro ? ['before'] : ['before', 'after'];

const lock = await acquireDevstackLock('ui/751-redirects captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.redirects-a11y-capture-'));
  await writeFile(resolve(harness, 'before-settings.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-redirects";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RedirectsSettings as After } from '@/features/site-redirects/components/redirects-settings';
import { useProject } from '@/hooks/api';
import { RedirectsSettings as Before } from './before-settings';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
await setLanguage(locale);
document.documentElement.classList.add(theme);
const Section = params.get('phase') === 'before' ? Before : After;
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
Object.assign(window, { fixture: { refetch: () => client.invalidateQueries() } });

/** Fixture chrome, not product UI: what has focus, by Chrome's computed role and name. */
function FocusReadout() {
  const [text, setText] = useState('');
  useEffect(() => {
    const read = () => requestAnimationFrame(() => {
      const active = document.activeElement as (HTMLElement & { computedRole?: string; computedName?: string }) | null;
      setText(!active || active === document.body ? 'nothing (body)' : active.computedRole + ' “' + active.computedName + '”');
    });
    read();
    document.addEventListener('focusin', read);
    document.addEventListener('focusout', read);
    return () => {
      document.removeEventListener('focusin', read);
      document.removeEventListener('focusout', read);
    };
  }, []);
  return (
    <div aria-hidden="true" dir="ltr" style={{ position: 'fixed', insetInline: 0, top: 0, zIndex: 50, padding: '4px 12px', font: '12px ui-monospace, monospace', background: '#111', color: '#fde047' }}>
      fixture · focus: {text}
    </div>
  );
}

/** The editor's Configuration canvas: a site picker (fixture), then the section keyed by site as the host does. */
function Canvas() {
  const [site, setSite] = useState<string | null>('site-1');
  const { data: project } = useProject(site ?? undefined);
  const button = 'rounded border border-border px-2 py-1 text-sm';
  return (
    <>
      <nav aria-label="Fixture" className="mb-4 flex gap-2" data-fixture-nav="">
        <button className={button} data-site="site-1" onClick={() => setSite('site-1')} type="button">Handbook</button>
        <button className={button} data-site="site-2" onClick={() => setSite('site-2')} type="button">Atlas</button>
        <button className={button} data-leave="" onClick={() => setSite(null)} type="button">Leave</button>
      </nav>
      {site && project?.id === site ? <Section key={project.id} project={project} /> : null}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <FocusReadout />
    <main className="mx-auto w-full max-w-4xl px-5 pt-12 pb-32 text-foreground sm:px-8"><Canvas /></main>
    <Toaster position={locale === 'ar' ? 'bottom-left' : 'bottom-right'} richColors theme={theme} />
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
      // server branch; the browser only ever takes the client one.
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

  /** Opens the fixture over an in-page store of both sites. */
  async function open(context, { phase, locale, theme = 'light' }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = structuredClone(SITES);
    const project = (id) => ({ id, name: server[id].name, slug: id, config: { theme: { preset: 'nib' }, redirects: server[id].redirects } });
    const json = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      const id = pathname.match(/^\/api\/app\/projects\/(site-[12])$/)?.[1];
      if (id && request.method() === 'GET') {
        requests.push({ call });
        return json(route, { data: project(id) });
      }
      if (id && request.method() === 'PATCH') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        // The API's merge: an array replaces the stored one.
        server[id].redirects = body.config.redirects;
        return json(route, { data: project(id) });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}&theme=${theme}`);
    await page.locator('[data-redirect-from]').first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(0, 0);
    return { page, errors, requests, server };
  }

  const m = (locale, key) => catalogs[locale][key];
  /** Chrome's computed name of every Remove, in row order. */
  const removeNames = (page) =>
    page
      .locator('[data-redirect-remove]')
      .evaluateAll((buttons) => buttons.map((button) => ({ role: button.computedRole, name: button.computedName })));
  /** What has focus, by Chrome's computed role and name, and where it is. */
  const focused = (page) =>
    page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return { at: 'body' };
      const row = active.closest('[data-redirect-row]');
      const control = ['from', 'to', 'remove'].find((name) => active.hasAttribute(`data-redirect-${name}`));
      const at =
        control ??
        (active.closest('[data-sonner-toaster]') ? 'toast' : active.closest('[data-fixture-nav]') ? 'fixture nav' : active.tagName.toLowerCase());
      return {
        at,
        row: row ? Number(row.getAttribute('data-redirect-row')) : undefined,
        role: active.computedRole,
        name: active.computedName,
        value: control && control !== 'remove' ? active.value : undefined,
        selection: control && control !== 'remove' ? [active.selectionStart, active.selectionEnd] : undefined,
      };
    });
  const state = async (page) => ({
    rows: await page
      .locator('[data-redirect-row]')
      .evaluateAll((rows) => rows.map((row) => [row.querySelector('[data-redirect-from]')?.value, row.querySelector('[data-redirect-to]')?.value])),
    focused: await focused(page),
    toasts: await page
      .locator('[data-sonner-toast]')
      .evaluateAll((toasts) => toasts.map((toast) => ({ text: toast.innerText, removed: toast.dataset.removed === 'true' }))),
    saveBar: await page
      .locator('[data-slot="save-region"]')
      .isVisible()
      .catch(() => false),
    conflict: await page
      .locator('[data-slot="callout"][data-tone="warning"]')
      .isVisible()
      .catch(() => false),
    problems: await page
      .locator('[data-slot="callout"][data-tone="danger"] li')
      .allInnerTexts()
      .catch(() => []),
  });
  const toastShown = (page) => page.locator('[data-sonner-toast]:not([data-removed="true"])').first().waitFor({ state: 'visible', timeout: 10_000 });
  /** The toast's own lifecycle: wait until Sonner has taken every toast off the page. */
  const toastsGone = (page) => page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0, null, { timeout: 15_000 });
  const undoIn = (page, locale) =>
    page.locator('[data-sonner-toast]:not([data-removed="true"]) button', { hasText: m(locale, 'settings_theme_undo') });
  /** Sonner's hotkey into the toasts, then Tab until Undo has focus. */
  const keyboardToUndo = async (page, locale) => {
    await toastShown(page);
    await page.keyboard.press('Alt+t');
    await page.waitForFunction(() => document.activeElement?.closest('[data-sonner-toaster]'));
    const label = m(locale, 'settings_theme_undo');
    for (let tab = 0; tab < 4; tab += 1) {
      if (await page.evaluate((text) => document.activeElement?.textContent === text, label)) return;
      await page.keyboard.press('Tab');
    }
    assert.fail('Tab never reached Undo');
  };
  const removeByKeyboard = async (page, row) => {
    await page.locator(`[data-redirect-row="${row}"] [data-redirect-remove]`).focus();
    await page.keyboard.press('Enter');
  };
  /** A click on the toast's Undo that moves no focus: how a screen reader's activation or a focus-less tap arrives. Synthetic. */
  const undoWithoutFocus = (page, locale) =>
    page.evaluate(
      (text) => {
        const undo = [...document.querySelectorAll('[data-sonner-toast] button')].find((button) => button.textContent === text);
        if (!undo) throw new Error('No Undo on the page');
        undo.click();
      },
      m(locale, 'settings_theme_undo'),
    );

  const names = [];
  const flows = [];
  const shots = [];
  const launch = { args: ['--enable-blink-features=ComputedAccessibilityInfo'] };
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)], launch }, async ({ browser, attempted }) => {
    // 1. Chrome's computed names of Remove, EN and AR, before and after.
    for (const locale of ['en', 'ar'])
      for (const phase of phases) {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
        const { page, errors } = await open(context, { phase, locale });
        const seen = await removeNames(page);
        assert.equal(typeof seen[0]?.name, 'string', 'Element.computedName is available');
        // Typing changes the source; the name follows it.
        await page.locator('[data-redirect-row="3"] [data-redirect-from]').fill('/api/v2');
        const afterTyping = (await removeNames(page))[3];
        names.push({
          locale,
          phase,
          dir: await page.evaluate(() => document.documentElement.dir),
          remove: seen,
          afterTypingRow3: afterTyping,
          pageErrors: errors,
        });
        assert.deepEqual(errors, []);
        await context.close();
      }

    // 2. The focus journeys, recorded, before and after.
    for (const phase of phases)
      for (const device of ['keyboard-en-1440', 'phone-ar-390']) {
        const phone = device.startsWith('phone');
        const locale = phone ? 'ar' : 'en';
        const viewport = phone ? { width: 390, height: 844 } : { width: 1440, height: 900 };
        const context = await browser.newContext({
          viewport,
          reducedMotion: 'reduce',
          ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
          recordVideo: { dir: harness, size: viewport },
        });
        const { page, errors, requests } = await open(context, { phase, locale });
        const steps = [];
        const note = async (step) => steps.push({ step, ...(await state(page)) });
        const pause = (ms = 600) => page.waitForTimeout(ms);
        await pause();
        await note('opened');

        if (phone) {
          await page.locator('[data-redirect-row="1"] [data-redirect-remove]').tap();
          await toastShown(page);
          await pause();
          await note('tap Remove /legacy');
          await undoIn(page, locale).tap();
          await page.waitForFunction(() => document.querySelectorAll('[data-redirect-row]').length === 4);
          await note('tap Undo');
          await toastsGone(page);
          await pause();
          await note('toast gone (its own lifecycle)');
        } else {
          // Keyboard: Remove, Alt+T, Tab to Undo, Enter.
          await removeByKeyboard(page, 1);
          await toastShown(page);
          await pause();
          await note('Enter on Remove /legacy');
          await keyboardToUndo(page, locale);
          await pause();
          await note('Alt+T, Tab: Undo has focus');
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => document.querySelectorAll('[data-redirect-row]').length === 4);
          await note('Enter on Undo');
          await toastsGone(page);
          await pause();
          await note('toast gone (its own lifecycle)');

          // Dismissed without Undo: Escape collapses the toasts, the timer runs out, Sonner returns focus.
          await removeByKeyboard(page, 1);
          await keyboardToUndo(page, locale);
          await note('Remove /legacy again, then Alt+T, Tab to Undo');
          await page.keyboard.press('Escape');
          await toastsGone(page);
          await pause();
          await note('Escape, then the toast times out: dismissed without Undo');
          await page.locator('[data-slot="save-region"] button', { hasText: m(locale, 'forms_discard') }).click();
          await page.waitForFunction(() => document.querySelectorAll('[data-redirect-row]').length === 4);
          await note('Discard (back to the saved rules)');

          // Mouse: click Remove, click Undo.
          await page.locator('[data-redirect-row="2"] [data-redirect-remove]').click();
          await undoIn(page, locale).click();
          await page.waitForFunction(() => document.querySelectorAll('[data-redirect-row]').length === 4);
          await page.mouse.move(0, 0);
          await note('click Remove /دليل, click Undo');
          await toastsGone(page);
          await pause();
          await note('toast gone (its own lifecycle)');

          // New focus: the person moved on and is typing in the next rule when Undo arrives without taking focus.
          await page.locator('[data-redirect-row="1"] [data-redirect-remove]').click();
          await toastShown(page);
          const field = page.locator('[data-redirect-row="1"] [data-redirect-to]');
          await field.click();
          await page.keyboard.press('End');
          await page.keyboard.type('&v=2', { delay: 60 });
          await page.keyboard.press('Shift+ArrowLeft');
          await page.keyboard.press('Shift+ArrowLeft');
          await note('Remove /legacy, then typing in the next rule (/دليل) destination, two characters selected');
          await undoWithoutFocus(page, locale);
          await page.waitForFunction(() => document.querySelectorAll('[data-redirect-row]').length === 4);
          await note('Undo without a focus move (synthetic click)');
          await page.keyboard.type('3', { delay: 60 });
          await note('the next key lands in the same rule');
          await toastsGone(page);
          await page.keyboard.press('Control+s');
          await page.waitForFunction(() => !document.querySelector('[data-slot="save-region"]'), null, { timeout: 15_000 });
          await pause();
          await note('Ctrl+S: saved, refetched, clean');

          // Leaving while Undo is stale: Leave (or another site), then a click on the exiting toast's Undo.
          for (const leave of ['[data-leave]', '[data-site="site-2"]']) {
            await page.locator('[data-site="site-1"]').click();
            await page.locator('[data-redirect-row="0"] [data-redirect-remove]').waitFor();
            await page.locator('[data-redirect-row="0"] [data-redirect-remove]').click();
            await toastShown(page);
            await page.evaluate(
              ({ leave, text }) => {
                const away = document.querySelector(leave);
                away.focus();
                away.click();
                const undo = [...document.querySelectorAll('[data-sonner-toast] button')].find((button) => button.textContent === text);
                if (!undo) throw new Error('The toast left before the late click');
                undo.click();
              },
              { leave, text: m(locale, 'settings_theme_undo') },
            );
            await toastsGone(page);
            await pause();
            await note(`Remove /guides/install, then ${leave === '[data-leave]' ? 'Leave' : 'switch to Atlas'} and click the exiting toast's Undo`);
          }
        }
        const video = page.video();
        await context.close();
        const file = `${repro ? 'repro-' : ''}${phase}-${device}.webm`;
        await video.saveAs(resolve(out, file));
        flows.push({ phase, device, locale, viewport, file, requests, pageErrors: errors, steps });
        assert.deepEqual(errors, []);
      }

    // 3. Conflict controls, with another writer changing the list.
    for (const phase of repro ? [] : phases) {
      const locale = 'en';
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      const { page, errors, requests, server } = await open(context, { phase, locale });
      const steps = [];
      const note = async (step) => steps.push({ step, ...(await state(page)) });
      const otherWriter = async (to) => {
        server['site-1'].redirects = [{ ...SITES['site-1'].redirects[0], to }, ...SITES['site-1'].redirects.slice(1)];
        await page.evaluate(() => window.fixture.refetch());
        await page.locator('[data-slot="callout"][data-tone="warning"]').waitFor();
      };
      await page.locator('[data-redirect-row="0"] [data-redirect-to]').fill('/mine');
      await otherWriter('/theirs');
      await note('dirty, and another writer changed rule 1: Use theirs or Keep mine');
      await page.getByRole('button', { name: m(locale, 'forms_keepmine') }).click();
      await removeByKeyboard(page, 2);
      await keyboardToUndo(page, locale);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('[data-redirect-row]').length === 4);
      await note('Keep mine, then Remove /دليل and Undo from the keyboard');
      await toastsGone(page);
      await otherWriter('/theirs-again');
      await page.locator('[data-redirect-row="1"] [data-redirect-remove]').click();
      await toastShown(page);
      await page.evaluate(
        ({ theirs, undoText }) => {
          const useTheirs = [...document.querySelectorAll('button')].find((button) => button.textContent === theirs);
          useTheirs.focus();
          useTheirs.click();
          const undo = [...document.querySelectorAll('[data-sonner-toast] button')].find((button) => button.textContent === undoText);
          if (!undo) throw new Error('The toast left before the late click');
          undo.click();
        },
        { theirs: m(locale, 'forms_usetheirs'), undoText: m(locale, 'settings_theme_undo') },
      );
      await toastsGone(page);
      await note("Remove /legacy, Use theirs, then a click on the exiting toast's Undo");
      flows.push({ phase, device: 'conflict-en-1440', locale, requests, pageErrors: errors, steps });
      assert.deepEqual(errors, []);
      await context.close();
    }

    // 4. EN/AR at 390 and 1440, light and dark: focus after a keyboard Undo, before (left) and after (right).
    for (const locale of repro ? [] : ['en', 'ar'])
      for (const width of [1440, 390])
        for (const theme of ['light', 'dark']) {
          const images = {};
          const seen = {};
          for (const phase of ['before', 'after']) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: theme });
            const { page, errors } = await open(context, { phase, locale, theme });
            await removeByKeyboard(page, 1);
            await keyboardToUndo(page, locale);
            await page.keyboard.press('Enter');
            await toastsGone(page);
            seen[phase] = {
              ...(await state(page)),
              overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
              pageErrors: errors,
            };
            assert.deepEqual(errors, []);
            images[phase] = await page.screenshot({ fullPage: true, animations: 'disabled' });
            await context.close();
          }
          const file = `focus-after-undo-${locale}-${width}-${theme}.png`;
          const sheet = await browser.newContext({ viewport: { width: width * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
          const sheetPage = await sheet.newPage();
          const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
          await sheetPage.setContent(
            `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Redirects · ${locale.toUpperCase()} · ${width}px · ${theme} · after Remove /legacy, Alt+T, Tab, Enter on Undo, and the toast gone</div>
<div style="display:flex;gap:16px;align-items:flex-start">${['before', 'after']
              .map(
                (phase) =>
                  `<figure style="margin:0"><figcaption style="margin-bottom:4px">${phase === 'before' ? 'before (main)' : 'after (this branch)'}</figcaption><img src="${img(images[phase])}" width="${width}"></figure>`,
              )
              .join('')}</div></body>`,
          );
          await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
          await sheetPage.screenshot({ path: resolve(out, file), fullPage: true });
          await sheet.close();
          shots.push({ file, locale, width, theme, before: seen.before, after: seen.after });
        }

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(out, repro ? 'repro-main.json' : 'evidence.json'), {
      environment:
        'Component fixture: the real Redirects section (before: main at the merge base; after: this branch) with the real design system, EN/AR catalogs, project query, config mutation and the design-system Sonner Toaster placed as the dashboard places it; fictional sites and public rules; project GET and config PATCH answered by interception; headless Chromium with Element.computedName for accessible names; not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: [componentPath],
      synthetic: [
        '"Undo without a focus move" dispatches element.click() on the real Undo button, as a screen reader activation or a focus-less tap does',
      ],
      attempted: attempted.length,
      names,
      flows,
      shots,
    });
  });
  console.log(`${names.length} name sets, ${flows.length} flows, ${shots.length} sheets; no page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
