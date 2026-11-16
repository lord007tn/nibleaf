// Isolated component fixture of Settings → Exports (one-time export and run
// history): main's ExportsSection (before) and this branch's (after) with the
// real design system, EN/AR catalogs, query hooks and the create / cancel /
// download-link mutations, for a fictional site. Every API request is answered
// by interception on the fixture origin; the artifact file itself is never
// served (the download starts and is cancelled locally). Not the signed-in
// dashboard and not production. No server starts and no export, run, job or
// file is created anywhere.
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
/** A message by its id as the code names it (`settings.exports.workflow.cancelError`). */
const msg = (locale, id, values = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const origin = 'http://exports.fixture.test';
const TIMEZONE = 'Africa/Lagos';
/** The main commit this branch starts from (#772); evidence.json records it as `base`. */
const BASE = '86e8cb74fe19eb3d6a87199ecd465ffb04812ded';
const SCHEDULE = { en: 'Handbook nightly', ar: 'أرشيف الدليل الليلي' };
const FILE_PATH = '/api/app/projects/site-1/exports/run-2/artifacts/pdf/file';

let harness;
try {
  harness = await mkdtemp(resolve(app, '.run-actions-capture-'));
  // Main's section and its export hooks as they are on the base (the run hooks are gone from this branch).
  await mkdir(resolve(harness, 'before'), { recursive: true });
  await writeFile(
    resolve(harness, 'before/exports-section.tsx'),
    git('show', `${BASE}:apps/app/src/components/project-settings/exports-section.tsx`)
      .replace("from './shared'", "from '@/components/project-settings/shared'")
      .replace("from '@/hooks/api/exports'", "from './exports-hooks'"),
  );
  await writeFile(
    resolve(harness, 'before/exports-hooks.ts'),
    git('show', `${BASE}:apps/app/src/hooks/api/exports.ts`).replaceAll("from './", "from '@/hooks/api/"),
  );
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-exports";\n@source "../src/components";\n@source "../../../packages/design-system/src";\n',
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
import { createRoot } from 'react-dom/client';
import { ExportsSection as After } from '@/components/project-settings/exports-section';
import { ExportsSection as Before } from './before/exports-section';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
const Section = params.get('version') === 'before' ? Before : After;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
      <ConfirmProvider>
        <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Section canManageSchedules={false} projectId="site-1" /></main>
      </ConfirmProvider>
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
   * Opens the fixture over an in-page store of three runs. `server.failNext`
   * answers the next create or cancel with that status; `server.delay` holds
   * each of them. A successful create adds a queued run and a successful
   * cancel marks the run cancelled, which the runs GET then reads back: a
   * stand-in for the API, not the API. The download link points back at a
   * path on the fixture origin that is never served.
   */
  async function open(context, { locale, version, surface }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const run = (id, overrides) => ({
      id,
      trigger: 'MANUAL',
      attempts: 1,
      error: null,
      snapshot: { deploymentVersion: 4, pagesCount: 18, createdAt: '2026-11-16T07:55:00.000Z' },
      artifacts: [],
      schedule: null,
      ...overrides,
    });
    const server = {
      runs: [
        run('run-3', { formats: ['MARKDOWN', 'PDF'], status: 'RUNNING', createdAt: '2026-11-16T08:10:00.000Z' }),
        run('run-2', {
          formats: ['PDF', 'STATIC_HTML'],
          status: 'SUCCEEDED',
          trigger: 'SCHEDULED',
          schedule: { id: 'schedule-1', name: SCHEDULE[locale] },
          createdAt: '2026-11-16T01:00:00.000Z',
          artifacts: [
            { id: 'pdf', format: 'PDF', fileName: 'handbook-v4.pdf', size: 2_516_582 },
            { id: 'html', format: 'STATIC_HTML', fileName: 'handbook-v4-html.zip', size: 8_493_465 },
          ],
        }),
        run('run-1', {
          formats: ['MARKDOWN'],
          status: 'FAILED',
          attempts: 3,
          error: 'ProviderError: fetch failed at renderer.ts:1',
          createdAt: '2026-11-15T16:42:00.000Z',
        }),
      ],
      failNext: 0,
      delay: 0,
      created: 0,
    };
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const refuse = (route) => {
      const status = server.failNext;
      server.failNext = 0;
      return json(route, { error: { message: 'Service unavailable' } }, status);
    };
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === 'GET /api/app/projects/site-1') {
        return json(route, { data: { id: 'site-1', name: 'Handbook', slug: 'handbook', hasPublishedVersion: true } });
      }
      if (call === 'GET /api/app/projects/site-1/deployments') return json(route, { data: [{ id: 'deployment-1', status: 'READY', version: 4 }] });
      if (call === 'GET /api/app/projects/site-1/exports') return json(route, { data: server.runs });
      if (call === 'GET /api/app/projects/site-1/exports/schedules') return json(route, { data: [] });
      if (call === 'POST /api/app/projects/site-1/exports') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        await wait(server.delay);
        if (server.failNext) return refuse(route);
        server.created += 1;
        const queued = run(`run-${3 + server.created}`, { formats: body.formats, status: 'PENDING', createdAt: new Date().toISOString() });
        server.runs.unshift(queued);
        return json(route, { data: queued }, 201);
      }
      const cancel = /^POST \/api\/app\/projects\/site-1\/exports\/([^/]+)\/cancel$/.exec(call);
      if (cancel) {
        requests.push({ call, body: request.postData() ? request.postDataJSON() : null });
        await wait(server.delay);
        if (server.failNext) return refuse(route);
        const found = server.runs.find(({ id }) => id === cancel[1]);
        found.status = 'CANCELLED';
        return json(route, { data: found });
      }
      if (call === 'GET /api/app/projects/site-1/exports/run-2/artifacts/pdf/download') {
        requests.push({ call });
        await wait(server.delay);
        // A stand-in for the signed storage URL; nothing ever requests it, and evidence.json does not record it.
        return json(route, { data: { url: 'https://storage.invalid/fixture?signature=fictional', fileUrl: FILE_PATH, fileName: 'handbook-v4.pdf' } });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('nav button').first().waitFor({ timeout: 15_000 });
    if (surface === 'history') {
      await page.locator('nav button').nth(2).click();
      await page.locator('section [data-slot="badge"]').first().waitFor({ timeout: 15_000 });
    }
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const ROW = 'section .rounded-lg.border.p-4';
  /** A run row's buttons, without the closed failure details. */
  const rowButtons = (page, index) => page.locator(ROW).nth(index).locator('button:not(details button)');
  /** What a reviewer should see: each run's status, details, buttons (accessible name, busy, disabled, focus), and toasts. */
  const state = async (page) =>
    page.evaluate((rowSelector) => {
      const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      return {
        dir: document.documentElement.dir,
        create: text(document.querySelector('section button[data-slot="button"]')),
        rows: [...document.querySelectorAll(rowSelector)].map((row) => ({
          status: text(row.querySelector('[data-slot="badge"]')),
          details: text(row.querySelector('.mt-1.text-xs')),
          buttons: [...row.querySelectorAll('button')]
            .filter((button) => !button.closest('details'))
            .map((button) => ({
              accessibleName: text(button),
              busy: button.getAttribute('aria-busy') === 'true',
              disabled: button.disabled,
              ariaDisabled: button.getAttribute('aria-disabled') === 'true',
              focused: document.activeElement === button,
            })),
        })),
        focusLost: document.activeElement === document.body,
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    }, ROW);

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const width of [390, 1440]) {
      const sheets = {};
      const seenByLocale = {};
      for (const locale of ['en', 'ar']) {
        const shots = {};
        const seenBy = {};
        const newContext = () =>
          browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light', timezoneId: TIMEZONE });
        const shoot = async (key, page, requests, errors) => {
          await page.waitForTimeout(300);
          const seen = await state(page);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.overflow, false, `${key} overflows at ${width}px`);
          assert.deepEqual(errors, []);
          shots[key] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          seenBy[key] = { ...seen, requests };
          return seen;
        };
        for (const version of ['before', 'after']) {
          // The one-time export form, unchanged.
          {
            const context = await newContext();
            const { page, requests, errors } = await open(context, { locale, version, surface: 'create' });
            const created = await shoot(`${version}-create`, page, requests, errors);
            assert.equal(created.create, msg(locale, 'settings.exports.workflow.create'));
            await context.close();
          }
          const context = await newContext();
          const { page, requests, errors, server } = await open(context, { locale, version, surface: 'history' });
          const listed = await shoot(`${version}-list`, page, requests, errors);
          const cancelLabel = msg(locale, 'common.cancel');
          const [cancelName] = listed.rows[0].buttons.map((button) => button.accessibleName);
          if (version === 'before') assert.equal(cancelName, cancelLabel);
          else {
            const formats = ['markdown', 'pdf'].map((format) => msg(locale, `settings.exports.workflow.format.${format}`)).join(', ');
            assert.ok(cancelName.startsWith(`${cancelLabel} ${formats} `), cancelName);
          }
          assert.deepEqual(
            listed.rows.map((row) => row.status),
            ['running', 'succeeded', 'failed'].map((status) => msg(locale, `settings.exports.workflow.status.${status}`)),
          );
          assert.ok(listed.rows[1].details.includes(SCHEDULE[locale]));

          // Cancel the running export from the keyboard while the server holds its answer, a 503.
          server.delay = 3000;
          server.failNext = 503;
          await rowButtons(page, 0).first().focus();
          const answered = page.waitForResponse((response) => response.url().endsWith('/cancel'));
          await page.keyboard.press('Enter');
          const pending = await shoot(`${version}-pending`, page, requests, errors);
          assert.deepEqual(
            pending.rows.map((row) => row.buttons.map((button) => button.busy)),
            [[true], [false, false], []],
          );
          assert.equal(pending.rows[0].status, msg(locale, 'settings.exports.workflow.status.running'));
          // Main's busy button is natively disabled and drops keyboard focus; here it keeps it.
          assert.equal(pending.rows[0].buttons[0].focused, version === 'after');
          assert.deepEqual(requests, [{ call: 'POST /api/app/projects/site-1/exports/run-3/cancel', body: null }]);

          // The 503 arrives: still running, as the server has it. Main says nothing; here the failure is shown.
          await answered;
          if (version === 'after') await page.locator('[data-sonner-toast]').first().waitFor();
          const refused = await shoot(`${version}-refused`, page, requests, errors);
          assert.equal(refused.rows[0].status, msg(locale, 'settings.exports.workflow.status.running'));
          assert.deepEqual(refused.toasts, version === 'after' ? [msg(locale, 'settings.exports.workflow.cancelError')] : []);
          await context.close();
        }
        seenByLocale[locale] = seenBy;
        sheets[locale] = shots;
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(width * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const panel = (locale, key) =>
        `<img src="data:image/png;base64,${sheets[locale][key].toString('base64')}" width="${shown}" style="display:block;border:1px solid #bbb">`;
      const rows = (locale) =>
        [
          ['create', 'One-time export: unchanged'],
          ['list', 'Run history: running, scheduled with two downloads, failed'],
          ['pending', 'Cancel pressed with Enter, the answer held: only that button is busy'],
          ['refused', 'Cancel refused (503): still running, as the server has it'],
        ]
          .map(
            ([key, label]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(locale, `before-${key}`)}</div><div>${panel(locale, `after-${key}`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Exports → one-time export and run history · ${width}px${scale < 1 ? ' (shown at 50%)' : ''} · fictional site and artifacts, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', timezone: TIMEZONE, ...seenByLocale });
    }

    // Create refused (503) → retry → queued; Cancel refused (503) → retry → cancelled; a download pressed twice.
    const locale = 'en';
    const width = 1440;
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      timezoneId: TIMEZONE,
      recordVideo: { dir: harness, size: { width, height: 900 } },
    });
    const { page, errors, requests, server } = await open(context, { locale, version: 'after', surface: 'create' });
    const downloads = [];
    page.on('download', async (download) => {
      // The file itself is not served: Playwright's routes don't see a download, and the local-only browser
      // can't reach the fixture host, so Chromium starts the download and then cancels it. Nothing leaves.
      downloads.push({ path: new URL(download.url()).pathname, suggestedFilename: download.suggestedFilename(), failure: await download.failure() });
    });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page)), requestsSoFar: requests.length });
    await pause();
    await page.locator('label[for="export-format-PDF"]').click();
    await note('one-time export: Markdown ZIP and PDF selected');
    server.failNext = 503;
    server.delay = 900;
    await page.locator('section button[data-slot="button"]').click();
    await pause(300);
    await note('create pending');
    await pause(1300);
    await note('create refused: toast, formats kept');
    await page.locator('section button[data-slot="button"]').click();
    await pause(1800);
    await note('create retried: queued');
    await page.locator('nav button').nth(2).click();
    await pause(900);
    await note('history: the queued export on top');
    server.failNext = 503;
    await rowButtons(page, 0).first().click();
    await pause(300);
    await note('cancel pending: only that button is busy');
    await pause(1300);
    await note('cancel refused: toast, still pending');
    await rowButtons(page, 0).first().click();
    await pause(2000);
    await note('cancel retried: read back as cancelled');
    await rowButtons(page, 2).first().dblclick();
    await pause(2000);
    await note('download pressed twice: one link, one download started');

    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    const pending = msg(locale, 'settings.exports.workflow.status.pending');
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [
      { call: 'POST /api/app/projects/site-1/exports', body: { formats: ['MARKDOWN', 'PDF'] } },
      { call: 'POST /api/app/projects/site-1/exports', body: { formats: ['MARKDOWN', 'PDF'] } },
      { call: 'POST /api/app/projects/site-1/exports/run-4/cancel', body: null },
      { call: 'POST /api/app/projects/site-1/exports/run-4/cancel', body: null },
      { call: 'GET /api/app/projects/site-1/exports/run-2/artifacts/pdf/download' },
    ]);
    // One download, of the file asked for, started from the link the fixture answered with.
    assert.deepEqual(downloads, [{ path: FILE_PATH, suggestedFilename: 'handbook-v4.pdf', failure: 'canceled' }]);
    assert.ok(at('create refused').toasts.includes(msg(locale, 'settings.exports.workflow.startError')));
    assert.ok(at('create retried').toasts.includes(msg(locale, 'settings.exports.workflow.queued')));
    assert.equal(at('history').rows[0].status, pending);
    assert.deepEqual(
      at('cancel pending').rows.map((row) => row.buttons.some((button) => button.busy)),
      [true, false, false, false],
    );
    assert.equal(at('cancel refused').rows[0].status, pending);
    assert.ok(at('cancel refused').toasts.includes(msg(locale, 'settings.exports.workflow.cancelError')));
    assert.equal(at('cancel retried').rows[0].status, msg(locale, 'settings.exports.workflow.status.cancelled'));
    assert.deepEqual(at('cancel retried').rows[0].buttons, []);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', timezone: TIMEZONE, requests, downloads, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's ExportsSection (${BASE}) and this branch's with the real design system, EN/AR catalogs, query hooks and export run mutations; fictional site and artifacts; every request answered by interception and the artifact file never served; not the signed-in dashboard, production, the worker, the scheduler or a real export file`,
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
    // Windows may hold the recording open for a moment after the browser closes.
    await rm(harness, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
