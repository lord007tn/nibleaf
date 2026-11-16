// Isolated component fixture of Settings → Exports → Schedules → New schedule:
// main's ExportsSection (before) and this branch's (after) with the real design
// system, EN/AR catalogs, query hooks and create mutation, for a fictional
// site. Every request is answered by interception on the fixture origin. Not
// the signed-in dashboard and not production. No server starts and no schedule
// or job is created anywhere.
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
/** A message by its id as the code names it (`settings.exports.workflow.createSchedule`). */
const msg = (locale, id, values = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const origin = 'http://exports.fixture.test';
const TIMEZONE = 'Africa/Lagos';
/** Pinned to the main commit this branch was captured against (evidence.json `base`); later main no longer has the old form. */
const BASE = '176033a4ac888cdc9673d86d147137e940856de2';

let harness;
try {
  harness = await mkdtemp(resolve(app, '.schedule-capture-'));
  // Main's section and its export hooks as they are on the base (main's create hook is gone from this branch).
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
   * Opens the fixture over an in-page store. `server.failNext` answers the
   * next schedule POST with that status; `server.delay` holds each POST. A
   * successful POST stores the body as a schedule, which the list GET then
   * reads back: a stand-in for the API, whose real schema runs in
   * packages/validators/src/schema.test.ts and in this branch's model tests.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { schedules: [], failNext: 0, delay: 0 };
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === 'GET /api/app/projects/site-1') {
        requests.push({ call });
        return json(route, { data: { id: 'site-1', name: 'Handbook', slug: 'handbook', hasPublishedVersion: true } });
      }
      if (call === 'GET /api/app/projects/site-1/deployments') {
        requests.push({ call });
        return json(route, { data: [{ id: 'deployment-1', status: 'READY', version: 3 }] });
      }
      if (call === 'GET /api/app/projects/site-1/exports') {
        requests.push({ call });
        return json(route, { data: [] });
      }
      if (call === 'GET /api/app/projects/site-1/exports/schedules') {
        requests.push({ call });
        return json(route, { data: server.schedules });
      }
      if (call === 'POST /api/app/projects/site-1/exports/schedules') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        await wait(server.delay);
        if (server.failNext) {
          const status = server.failNext;
          server.failNext = 0;
          const message = status === 409 ? 'At most 20 archive schedules may be configured per project.' : 'Service unavailable';
          return json(route, { error: { message } }, status);
        }
        const schedule = {
          id: `schedule-${server.schedules.length + 1}`,
          enabled: true,
          nextRunAt: null,
          lastError: null,
          _count: { jobs: 0 },
          ...body,
        };
        server.schedules = [schedule, ...server.schedules];
        return json(route, { data: schedule }, 201);
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('nav button').nth(1).click();
    await page.getByRole('button', { name: msg(locale, 'settings.exports.workflow.newSchedule') }).click();
    await field(page, locale, 'settings.exports.workflow.scheduleName').waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const field = (page, locale, id) => page.getByLabel(msg(locale, id), { exact: true });
  const createButton = (page) => page.locator('form button[type="submit"]');
  /** What a reviewer should see: field values, which are invalid and why, the focused field, Create's state, alerts and toasts. */
  const state = async (page) =>
    page.evaluate(() => {
      const form = document.querySelector('form');
      const labelOf = (control) => document.querySelector(`label[for="${control.id}"]`)?.textContent ?? control.id;
      const controls = form ? [...form.querySelectorAll('input:not([type="checkbox"]), button[role="combobox"]')] : [];
      const submit = form?.querySelector('button[type="submit"]');
      return {
        dir: document.documentElement.dir,
        formOpen: Boolean(form),
        fields: Object.fromEntries(controls.map((control) => [labelOf(control), control.value ?? control.textContent?.trim()])),
        invalid: controls
          .filter((control) => control.getAttribute('aria-invalid') === 'true')
          .map((control) => ({
            field: labelOf(control),
            message: (control.getAttribute('aria-describedby') ?? '')
              .split(' ')
              .map((id) => document.getElementById(id))
              .find((node) => node?.dataset.slot === 'settings-row-error')?.textContent,
          })),
        focused: document.activeElement && document.activeElement !== document.body ? labelOf(document.activeElement) : null,
        create: submit ? { text: submit.textContent?.trim(), disabled: submit.disabled, loading: submit.hasAttribute('data-loading') } : null,
        alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent?.trim()).filter(Boolean),
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
        scheduleRows: [...document.querySelectorAll('section span[dir="auto"]')].map((node) => node.textContent),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  const posts = (requests) => requests.filter(({ call }) => call.startsWith('POST')).map(({ body }) => body);

  /** Blank name, blank runs to retain, blank time: on main Create greys out and the blank number shows 0; here Create explains each. */
  async function makeInvalid(page, locale, version) {
    await field(page, locale, 'settings.exports.workflow.scheduleName').fill('');
    await field(page, locale, 'settings.exports.workflow.retainRuns').fill('');
    await field(page, locale, 'settings.exports.workflow.localTime').fill('');
    if (version === 'after') await createButton(page).click();
    await page.waitForTimeout(300);
  }

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
          await page.mouse.move(0, 0);
          await page.waitForTimeout(300);
          const seen = await state(page);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.overflow, false, `${key} overflows at ${width}px`);
          assert.deepEqual(errors, []);
          shots[key] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          seenBy[key] = { ...seen, requests: requests.map(({ call, body }) => (body ? { call, body } : call)) };
          return seen;
        };
        for (const version of ['before', 'after']) {
          let context = await newContext();
          let opened = await open(context, { locale, version });
          const opening = await shoot(`${version}-default`, opened.page, opened.requests, opened.errors);
          assert.equal(
            opening.fields[msg(locale, 'settings.exports.workflow.scheduleName')],
            msg(locale, 'settings.exports.workflow.defaultScheduleName'),
          );
          assert.equal(opening.invalid.length, 0);
          await makeInvalid(opened.page, locale, version);
          const invalid = await shoot(`${version}-invalid`, opened.page, opened.requests, opened.errors);
          assert.deepEqual(posts(opened.requests), []);
          if (version === 'before') {
            assert.equal(invalid.fields[msg(locale, 'settings.exports.workflow.retainRuns')], '0', 'main turns a blank number into 0');
            assert.equal(invalid.create.disabled, true);
            assert.equal(invalid.invalid.length, 0);
          } else {
            assert.equal(invalid.fields[msg(locale, 'settings.exports.workflow.retainRuns')], '');
            assert.deepEqual(
              invalid.invalid.map(({ field: name }) => name),
              ['settings.exports.workflow.scheduleName', 'settings.exports.workflow.localTime', 'settings.exports.workflow.retainRuns'].map((id) =>
                msg(locale, id),
              ),
            );
            assert.equal(invalid.focused, msg(locale, 'settings.exports.workflow.scheduleName'));
          }
          await context.close();

          // A refused creation (409, the site's schedule limit), waiting for a retry.
          context = await newContext();
          opened = await open(context, { locale, version });
          await field(opened.page, locale, 'settings.exports.workflow.scheduleName').fill(locale === 'ar' ? 'أرشيف الدليل' : 'Handbook archive');
          opened.server.failNext = 409;
          await createButton(opened.page).click();
          await opened.page.waitForTimeout(800);
          const refused = await shoot(`${version}-retry`, opened.page, opened.requests, opened.errors);
          const limit = msg(locale, 'settings.exports.workflow.scheduleLimit');
          assert.equal(posts(opened.requests).length, 1);
          if (version === 'before') assert.ok(refused.toasts.some((text) => text.includes(limit)));
          else {
            assert.deepEqual(refused.alerts, [limit]);
            assert.deepEqual(refused.toasts, []);
            assert.equal(refused.create.disabled, false);
          }
          assert.ok(refused.formOpen);
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
          ['default', 'Opened'],
          ['invalid', 'Blank name, time and runs to retain (after: then Create)'],
          ['retry', 'Create refused with 409 (schedule limit), waiting for a retry'],
        ]
          .map(
            ([key, label]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(locale, `before-${key}`)}</div><div>${panel(locale, `after-${key}`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Exports → Schedules → New schedule · ${width}px${scale < 1 ? ' (shown at 50%)' : ''} · fictional site, timezone ${TIMEZONE}, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', timezone: TIMEZONE, ...seenByLocale });
    }

    // Create → refused (503) → retry → created and closed, with the list read back from the fixture store.
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
    const note = async (step) => steps.push({ step, ...(await state(page)), requestsSoFar: requests.length, stored: server.schedules.length });
    await pause();
    await note('opened: defaults, nothing invalid');
    await field(page, locale, 'settings.exports.workflow.scheduleName').fill('Handbook weekly archive');
    await field(page, locale, 'settings.exports.workflow.retainRuns').fill('30');
    await pause(400);
    await note('typed a name and 30 runs to retain');
    server.failNext = 503;
    server.delay = 900;
    await createButton(page).click();
    await pause(300);
    await note('creating: fields frozen, Create shows progress');
    await pause(1300);
    await note('refused: one error, everything kept for a retry');
    server.delay = 900;
    await createButton(page).click();
    await pause(2000);
    await note('retry: created, announced and closed; the list reads the new schedule back');

    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    const sent = posts(requests);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[1], sent[0]);
    assert.deepEqual(sent[0], {
      name: 'Handbook weekly archive',
      formats: ['MARKDOWN', 'PDF', 'STATIC_HTML'],
      cadence: 'DAILY',
      timezone: TIMEZONE,
      hour: 2,
      minute: 0,
      retentionCount: 30,
      retentionDays: 90,
    });
    assert.equal(at('creating').create.loading, true);
    assert.deepEqual(at('refused').alerts, [msg(locale, 'settings.saveError')]);
    assert.equal(at('refused').fields[msg(locale, 'settings.exports.workflow.retainRuns')], '30');
    assert.equal(at('retry').formOpen, false);
    assert.ok(at('retry').toasts.includes(msg(locale, 'settings.exports.workflow.scheduleCreated')));
    assert.deepEqual(at('retry').scheduleRows, ['Handbook weekly archive']);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', timezone: TIMEZONE, requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's ExportsSection (${BASE}) and this branch's with the real design system, EN/AR catalogs, query hooks and create mutation; fictional site; every request answered by interception; not the signed-in dashboard or production`,
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
