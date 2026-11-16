// Isolated component fixture of Settings → Exports → Schedules: main's
// ExportsSection (before) and this branch's (after) with the real design
// system, EN/AR catalogs, query hooks and the Run now / Enable / Disable
// mutations, for a fictional site. Every request is answered by interception on
// the fixture origin. Not the signed-in dashboard and not production. No server
// starts and no schedule, run or job is created or changed anywhere.
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
/** A message by its id as the code names it (`settings.exports.workflow.runNow`). */
const msg = (locale, id, values = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const origin = 'http://exports.fixture.test';
const TIMEZONE = 'Africa/Lagos';
/** The main commit this branch starts from (#771); evidence.json records it as `base`. */
const BASE = 'a4230029eb7c5f9cc25ebe5eed9aba62f703f0b7';
const NAMES = { en: ['Handbook nightly', 'Handbook monthly'], ar: ['أرشيف الدليل الليلي', 'أرشيف الدليل الشهري'] };

let harness;
try {
  harness = await mkdtemp(resolve(app, '.schedule-actions-capture-'));
  // Main's section and its export hooks as they are on the base (the row's two hooks are gone from this branch).
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
        <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Section canManageSchedules projectId="site-1" /></main>
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
   * Opens the fixture over an in-page store of two schedules. `server.failNext`
   * answers the next PATCH or run POST with that status; `server.delay` holds
   * each of them. A successful PATCH stores `enabled` and a successful run adds
   * one to the schedule's run count, which the list GET then reads back: a
   * stand-in for the API, not the API.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const [nightly, monthly] = NAMES[locale];
    const server = {
      schedules: [
        { id: 'schedule-1', name: nightly, formats: ['MARKDOWN'], cadence: 'DAILY', timezone: TIMEZONE, hour: 2, minute: 0, enabled: true },
        { id: 'schedule-2', name: monthly, formats: ['PDF'], cadence: 'MONTHLY', timezone: 'UTC', hour: 23, minute: 30, enabled: false },
      ].map((schedule, index) => ({
        retentionCount: 30,
        retentionDays: 90,
        nextRunAt: index === 0 ? '2026-11-17T01:00:00.000Z' : null,
        lastError: index === 1 ? 'No published revision is available.' : null,
        _count: { jobs: index === 0 ? 12 : 1 },
        ...schedule,
      })),
      failNext: 0,
      delay: 0,
    };
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === 'GET /api/app/projects/site-1') {
        return json(route, { data: { id: 'site-1', name: 'Handbook', slug: 'handbook', hasPublishedVersion: true } });
      }
      if (call === 'GET /api/app/projects/site-1/deployments') return json(route, { data: [{ id: 'deployment-1', status: 'READY', version: 3 }] });
      if (call === 'GET /api/app/projects/site-1/exports') return json(route, { data: [] });
      if (call === 'GET /api/app/projects/site-1/exports/schedules') {
        requests.push({ call });
        return json(route, { data: server.schedules });
      }
      const write = /^(PATCH|POST) \/api\/app\/projects\/site-1\/exports\/schedules\/([^/]+)(\/run)?$/.exec(call);
      if (write && (write[1] === 'PATCH' ? !write[3] : write[3])) {
        const body = request.postData() ? request.postDataJSON() : null;
        requests.push({ call, body });
        await wait(server.delay);
        if (server.failNext) {
          const status = server.failNext;
          server.failNext = 0;
          return json(route, { error: { message: 'Service unavailable' } }, status);
        }
        const schedule = server.schedules.find(({ id }) => id === write[2]);
        if (write[1] === 'PATCH') {
          Object.assign(schedule, body);
          return json(route, { data: schedule });
        }
        schedule._count.jobs += 1;
        return json(route, { data: { id: `run-${schedule._count.jobs}`, status: 'PENDING' } }, 201);
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('nav button').nth(1).click();
    await page.locator('section span[dir="auto"]', { hasText: nightly }).waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  /** The row's buttons by position: [Run now, Enable/Disable] for each schedule. */
  const rowButtons = (page, index) => page.locator('section .rounded-lg.border.p-3').nth(index).locator('button');
  /** What a reviewer should see: each row's status, details, buttons (accessible name, busy, disabled, focus), and toasts. */
  const state = async (page) =>
    page.evaluate(() => {
      const rows = [...document.querySelectorAll('section .rounded-lg.border.p-3')];
      return {
        dir: document.documentElement.dir,
        rows: rows.map((row) => ({
          name: row.querySelector('span[dir="auto"]')?.textContent,
          status: row.querySelector('[data-slot="badge"]')?.textContent,
          details: row.querySelector('.mt-1.text-xs')?.textContent?.replace(/\s+/g, ' ').trim(),
          failure: row.querySelector('p.text-destructive')?.textContent ?? null,
          buttons: [...row.querySelectorAll(':scope > .flex.gap-2 > button')].map((button) => ({
            accessibleName: button.textContent?.replace(/\s+/g, ' ').trim(),
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
    });
  const writes = (requests) => requests.filter(({ call }) => !call.startsWith('GET'));

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const width of [390, 1440]) {
      const sheets = {};
      const seenByLocale = {};
      for (const locale of ['en', 'ar']) {
        const shots = {};
        const seenBy = {};
        const [nightly, monthly] = NAMES[locale];
        const newContext = () =>
          browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light', timezoneId: TIMEZONE });
        const shoot = async (key, page, requests, errors) => {
          await page.waitForTimeout(300);
          const seen = await state(page);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.overflow, false, `${key} overflows at ${width}px`);
          assert.deepEqual(errors, []);
          shots[key] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          seenBy[key] = { ...seen, requests: writes(requests) };
          return seen;
        };
        for (const version of ['before', 'after']) {
          const context = await newContext();
          const { page, requests, errors, server } = await open(context, { locale, version });
          const names = (seen) => seen.rows.flatMap((row) => row.buttons.map((button) => button.accessibleName));
          const listed = await shoot(`${version}-list`, page, requests, errors);
          const runNow = msg(locale, 'settings.exports.workflow.runNow');
          const disable = msg(locale, 'settings.exports.workflow.disable');
          const enable = msg(locale, 'settings.exports.workflow.enable');
          assert.deepEqual(
            names(listed),
            version === 'before'
              ? [runNow, disable, runNow, enable]
              : [`${runNow} ${nightly}`, `${disable} ${nightly}`, `${runNow} ${monthly}`, `${enable} ${monthly}`],
          );
          assert.equal(listed.rows[1].failure, msg(locale, 'failures.unpublished'));

          // Disable the first schedule from the keyboard while the server holds its answer, a 503.
          server.delay = 3000;
          server.failNext = 503;
          await rowButtons(page, 0).nth(1).focus();
          await page.keyboard.press('Enter');
          const pending = await shoot(`${version}-pending`, page, requests, errors);
          assert.deepEqual(
            pending.rows.map((row) => row.buttons.map((button) => button.busy)),
            [
              [false, true],
              [false, false],
            ],
          );
          assert.equal(pending.rows[0].status, msg(locale, 'settings.exports.workflow.enabled'));
          // Main's busy button is natively disabled and drops keyboard focus; here it keeps it.
          assert.equal(pending.rows[0].buttons[1].focused, version === 'after');
          assert.deepEqual(writes(requests), [{ call: 'PATCH /api/app/projects/site-1/exports/schedules/schedule-1', body: { enabled: false } }]);

          // The 503 arrives: the value stays as the server has it.
          await page.locator('[data-sonner-toast]').first().waitFor();
          const refused = await shoot(`${version}-refused`, page, requests, errors);
          assert.equal(refused.rows[0].status, msg(locale, 'settings.exports.workflow.enabled'));
          assert.ok(refused.toasts.includes(msg(locale, 'settings.saveError')));
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
          ['list', 'Two schedules, the second disabled with its last failure'],
          ['pending', 'Disable pressed with Enter, the answer held: only that button is busy'],
          ['refused', 'Disable refused (503): the toast, and the value as the server has it'],
        ]
          .map(
            ([key, label]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(locale, `before-${key}`)}</div><div>${panel(locale, `after-${key}`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Exports → Schedules · ${width}px${scale < 1 ? ' (shown at 50%)' : ''} · fictional site, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', timezone: TIMEZONE, ...seenByLocale });
    }

    // Disable → refused (503) → retry → disabled; then Run now pressed twice, queued once.
    const locale = 'en';
    const width = 1440;
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      timezoneId: TIMEZONE,
      recordVideo: { dir: harness, size: { width, height: 900 } },
    });
    const { page, errors, requests, server } = await open(context, { locale, version: 'after' });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page)), writesSoFar: writes(requests).length });
    await pause();
    await note('listed');
    server.failNext = 503;
    server.delay = 900;
    await rowButtons(page, 0).nth(1).click();
    await pause(300);
    await note('disable pending: only that button is busy');
    await pause(1300);
    await note('refused: toast, still enabled');
    await rowButtons(page, 0).nth(1).click();
    await pause(2000);
    await note('retried: disabled, read back from the fixture store');
    await rowButtons(page, 0).nth(0).dblclick();
    await pause(300);
    await note('run pending after a double press');
    await pause(2000);
    await note('run queued once; run count read back');

    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    assert.deepEqual(writes(requests), [
      { call: 'PATCH /api/app/projects/site-1/exports/schedules/schedule-1', body: { enabled: false } },
      { call: 'PATCH /api/app/projects/site-1/exports/schedules/schedule-1', body: { enabled: false } },
      { call: 'POST /api/app/projects/site-1/exports/schedules/schedule-1/run', body: null },
    ]);
    assert.deepEqual(
      at('disable pending').rows.map((row) => row.buttons.map((button) => button.busy)),
      [
        [false, true],
        [false, false],
      ],
    );
    assert.equal(at('refused').rows[0].status, msg(locale, 'settings.exports.workflow.enabled'));
    assert.ok(at('refused').toasts.includes(msg(locale, 'settings.saveError')));
    assert.equal(at('retried').rows[0].status, msg(locale, 'settings.exports.workflow.disabled'));
    assert.equal(at('retried').rows[0].buttons[1].accessibleName, `${msg(locale, 'settings.exports.workflow.enable')} ${NAMES.en[0]}`);
    assert.equal(at('run pending').rows[0].buttons[0].busy, true);
    assert.ok(at('run queued').toasts.includes(msg(locale, 'settings.exports.workflow.runQueued')));
    assert.ok(at('run queued').rows[0].details.includes(msg(locale, 'settings.exports.workflow.runCount', { count: 13 })));
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', timezone: TIMEZONE, requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's ExportsSection (${BASE}) and this branch's with the real design system, EN/AR catalogs, query hooks and schedule mutations; fictional site; every request answered by interception; not the signed-in dashboard or production`,
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
