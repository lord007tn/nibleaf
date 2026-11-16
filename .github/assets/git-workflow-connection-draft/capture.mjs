// Isolated component fixture of Settings → Git → Connection settings → Connection configuration: main's
// GitWorkflow (before) and this branch's (after), with the real design system, EN/AR catalogs, the app's
// QueryClient, the status query and the save mutation, for a fictional site and repository. Every API request is
// answered by interception on the fixture origin, held until the script answers it. Not the signed-in dashboard
// and not production. No server starts, and nothing reaches any Git provider. No token is ever typed.
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
/** A message by its id as the code names it (`settings.git.workflow.saveConnection`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://git-workflow-connection.fixture.test';
/** The main commit this branch last merged (#793), pinned; evidence.json records it as `base`. */
const BASE = '861c6f1fff9287a46fabb0582c024214eceb7f35';
const SITE = 'site-1';
const STATUS = `GET /api/app/projects/${SITE}/git`;
const SAVE = `PUT /api/app/projects/${SITE}/git/connection`;
/** The fictional stored connection: settings, the import targets the form never shows, and sync state. */
const STORED = {
  id: 'connection-1',
  repository: 'acme-fixture/handbook',
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  importBranchId: 'branch-fixture-1',
  importLanguageId: 'language-fixture-1',
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncStatus: 'SUCCEEDED',
  lastSyncError: null,
  lastSyncedAt: '2026-11-15T09:00:00.000Z',
  operations: [],
  pullRequests: [],
  files: [],
};
/** A refusal the fixture invents (no Git provider is reached). */
const REFUSED = { status: 400, body: { error: { message: 'Base branch trunk was not found.' } } };
const TARGETS = { importBranchId: STORED.importBranchId, importLanguageId: STORED.importLanguageId };
/** The evidence names each fixture ID by a label in order of first use (same ID, same label), never the raw value. */
const idLabels = new Map();
const labelId = (value) => {
  if (!idLabels.has(value)) idLabels.set(value, `<id#${idLabels.size + 1}>`);
  return idLabels.get(value);
};
const labelled = (saves) =>
  saves.map(({ call, body }) => ({
    call,
    body: Object.fromEntries(Object.entries(body).map(([key, value]) => [key, /Id$/.test(key) ? labelId(value) : value])),
  }));

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-workflow-connection-capture-'));
  await mkdir(resolve(harness, 'before'), { recursive: true });
  // Main's component as it is on the base; it imports only modules this branch still has unchanged.
  await writeFile(resolve(harness, 'before/git-workflow.tsx'), git('show', `${BASE}:apps/app/src/components/settings/git-workflow.tsx`));
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-git";\n@source "../src/components";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { GitWorkflow as After } from '@/components/settings/git-workflow';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { GitWorkflow as Before } from './before/git-workflow';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = createQueryClient();
const invalidate = client.invalidateQueries.bind(client);
window.__refreshed = [];
client.invalidateQueries = (filters, options) => {
  window.__refreshed.push(filters?.queryKey);
  return invalidate(filters, options);
};
const Workflow = params.get('version') === 'before' ? Before : After;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
        <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Workflow projectId="${SITE}" /></main>
      </DirectionProvider>
      <Toaster theme="light" />
    </ConfirmProvider>
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
   * Opens the fixture. `server.stored` is what the status answers. A save waits `server.delay` ms, or, with
   * `server.hold`, until `server.release()`; then it answers `server.answers.shift()`, or stores the normalized
   * settings `server.stores` names and answers as the server does.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const saves = [];
    const reads = [];
    const held = [];
    const server = {
      stored: structuredClone(STORED),
      stores: {},
      delay: 0,
      hold: false,
      answers: [],
      release: () => held.shift()?.(),
      held: () => held.length,
    };
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === STATUS) {
        reads.push(call);
        return json(route, { data: server.stored });
      }
      if (call === SAVE) {
        const body = request.postDataJSON();
        assert.ok(!('token' in body), 'the fixture never types a token');
        saves.push({ call, body });
        if (server.hold) await new Promise((done) => held.push(done));
        else await wait(server.delay);
        const answer = server.answers.shift();
        if (answer) return json(route, answer.body, answer.status);
        server.stored = { ...server.stored, ...server.stores };
        return json(route, { data: { connection: server.stored, webhookSecret: null } });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('nav button[aria-pressed]').first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('nav button[aria-pressed]', { hasText: msg(locale, 'settings.git.workflow.nav.connection') }).click();
    await page.locator('#git2-update-repo').waitFor();
    return { page, errors, saves, reads, server };
  }

  const saveButton = (page, locale) => page.locator('button', { hasText: msg(locale, 'settings.git.workflow.saveConnection') });
  const refresh = (page, locale) =>
    page
      .locator('button', { hasText: msg(locale, 'common.refresh') })
      .first()
      .click();
  /** What a reviewer should see: the fields, conflict, Discard, Save (busy), problems, focus, toasts and refreshes. */
  const state = async (page, locale) =>
    page.evaluate(
      ({ saveLabel, discardLabel, conflictText }) => {
        const value = (id) => document.getElementById(id)?.value ?? null;
        const find = (label) => [...document.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(label));
        return {
          dir: document.documentElement.dir,
          fields: {
            repository: value('git2-update-repo'),
            baseBranch: value('git2-update-base'),
            headBranch: value('git2-update-head'),
            contentPath: value('git2-update-path'),
            tokenTyped: Boolean(value('git2-update-token')),
          },
          conflict: document.body.textContent?.includes(conflictText) ?? false,
          discard: Boolean(find(discardLabel)),
          saveBusy: find(saveLabel)?.getAttribute('aria-busy') === 'true',
          invalid: [...document.querySelectorAll('[aria-invalid="true"]')].map((node) => node.id),
          focused: document.activeElement?.id || null,
          toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
          refreshed: window.__refreshed,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      },
      {
        saveLabel: msg(locale, 'settings.git.workflow.saveConnection'),
        discardLabel: msg(locale, 'forms.discard'),
        conflictText: msg(locale, 'forms.changedElsewhere'),
      },
    );
  const waitFor = async (page, check) => {
    for (let tries = 0; !check() && tries < 100; tries += 1) await page.waitForTimeout(50);
    await page.waitForTimeout(300);
  };
  const settings = { repository: STORED.repository, baseBranch: STORED.baseBranch, headBranch: STORED.headBranch, contentPath: STORED.contentPath };

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const width of [390, 1440]) {
      const sheets = {};
      const seenByLocale = {};
      for (const locale of ['en', 'ar']) {
        const shots = {};
        const seenBy = {};
        const newContext = () => browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
        const shoot = async (key, page, { saves, reads, errors }) => {
          await page.waitForTimeout(300);
          const seen = await state(page, locale);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.overflow, false, `${key} overflows at ${width}px`);
          assert.deepEqual(errors, []);
          await page.locator('#git2-update-repo').scrollIntoViewIfNeeded();
          shots[key] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          seenBy[key] = { ...seen, saves: labelled(saves), statusReads: reads.length };
          return seen;
        };
        const after = (version) => version === 'after';
        for (const version of ['before', 'after']) {
          // Ready, then a path edit and a refresh that only changes the sync state.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version });
            const { page, server } = opened;
            const ready = await shoot(`${version}-ready`, page, opened);
            assert.deepEqual(ready.fields, { ...settings, tokenTyped: false });
            await page.locator('#git2-update-path').fill('guides');
            server.stored = { ...server.stored, lastSyncStatus: 'RUNNING' };
            await refresh(page, locale);
            await waitFor(page, () => opened.reads.length >= 2);
            const kept = await shoot(`${version}-syncStateRefresh`, page, opened);
            assert.equal(kept.fields.contentPath, after(version) ? 'guides' : 'docs');
            await context.close();
          }
          // Another writer changes the base branch the person is also editing.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version });
            const { page, server } = opened;
            await page.locator('#git2-update-base').fill('develop');
            await page.locator('#git2-update-path').fill('guides');
            server.stored = { ...server.stored, baseBranch: 'trunk' };
            await refresh(page, locale);
            await waitFor(page, () => opened.reads.length >= 2);
            const changed = await shoot(`${version}-changedElsewhere`, page, opened);
            assert.deepEqual(
              { base: changed.fields.baseBranch, path: changed.fields.contentPath, conflict: changed.conflict },
              after(version) ? { base: 'develop', path: 'guides', conflict: true } : { base: 'trunk', path: 'docs', conflict: false },
            );
            await context.close();
          }
          // A save held, an edit typed while it runs, then its own readback.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version });
            const { page, server, saves } = opened;
            server.hold = true;
            server.stores = { repository: 'acme-fixture/manual' };
            await page.locator('#git2-update-repo').fill(' https://github.com/acme-fixture/manual.git ');
            await saveButton(page, locale).click();
            await waitFor(page, () => saves.length >= 1);
            await page.locator('#git2-update-path').fill('typed-during-save');
            const pending = await shoot(`${version}-savePending`, page, opened);
            assert.equal(pending.saveBusy, true);
            server.release();
            await waitFor(page, () => opened.reads.length >= 2);
            const readback = await shoot(`${version}-readback`, page, opened);
            assert.deepEqual(saves[0].body, {
              ...settings,
              repository: ' https://github.com/acme-fixture/manual.git ',
              ...(after(version) ? TARGETS : {}),
            });
            assert.equal(readback.fields.repository, 'acme-fixture/manual');
            assert.equal(readback.fields.contentPath, after(version) ? 'typed-during-save' : 'docs');
            assert.deepEqual(readback.toasts, after(version) ? [] : [msg(locale, 'settings.git.workflow.connected')]);
            await context.close();
          }
          // A blank repository, saved.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version });
            const { page, server, saves } = opened;
            server.answers.push({ status: 400, body: { error: { message: 'Use owner/repository or a GitHub repository URL.' } } });
            await page.locator('#git2-update-repo').fill('');
            await saveButton(page, locale).click();
            await page.waitForTimeout(500);
            const invalid = await shoot(`${version}-blankRepository`, page, opened);
            assert.equal(saves.length, after(version) ? 0 : 1);
            assert.deepEqual(invalid.invalid, after(version) ? ['git2-update-repo'] : []);
            if (after(version)) assert.equal(invalid.focused, 'git2-update-repo');
            await context.close();
          }
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
          ['ready', 'Connection configuration ready (same layout)'],
          ['syncStateRefresh', 'Path edited, Refresh returns only a new sync state: before wipes the edit'],
          [
            'changedElsewhere',
            'Base and path edited, someone else changed the base: before overwrites both silently; after keeps them and shows the conflict',
          ],
          ['savePending', 'Save held, path typed during it'],
          ['readback', 'Its readback: before wipes the path typed during the save and says saved; after keeps it, dirty'],
          ['blankRepository', 'Repository blank, Save: before sends it (refused by the fixture); after says why on the field'],
        ]
          .map(
            ([key, label]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(locale, `before-${key}`)}</div><div>${panel(locale, `after-${key}`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Connection configuration · ${width}px${scale < 1 ? ' (shown at 50%)' : ''} · fictional site and repository, every request intercepted, no token typed</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', ...seenByLocale });
    }

    // Held save → refresh during it (someone else changed the path) → refused → retry → readback, clean.
    const locale = 'en';
    const width = 1440;
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 900 } },
    });
    const { page, errors, saves, reads, server } = await open(context, { locale, version: 'after' });
    await page.locator('#git2-update-repo').scrollIntoViewIfNeeded();
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page, locale)), savesSoFar: saves.length, statusReads: reads.length });
    await pause();
    await note('ready');
    await page.locator('#git2-update-base').fill('trunk');
    await pause();
    server.hold = true;
    server.answers.push(REFUSED);
    await saveButton(page, locale).click();
    await pause(400);
    await note('save held: busy');
    server.stored = { ...server.stored, contentPath: 'content' };
    await refresh(page, locale);
    await pause(900);
    await note('refresh during the save: the untouched path follows the server');
    server.release();
    await pause(1500);
    await note('refused: explained once, values kept');
    server.hold = false;
    server.delay = 1500;
    server.stores = { baseBranch: 'trunk' };
    await saveButton(page, locale).click();
    await pause(400);
    await note('retried: busy');
    await pause(2200);
    await note('saved: readback clean, "saved" once');
    await pause(1200);

    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    assert.deepEqual(
      saves.map(({ body }) => body),
      [
        { ...settings, baseBranch: 'trunk', ...TARGETS },
        { ...settings, baseBranch: 'trunk', contentPath: 'content', ...TARGETS },
      ],
    );
    assert.equal(at('save held').saveBusy, true);
    assert.equal(at('refresh during').fields.contentPath, 'content');
    assert.equal(at('refresh during').fields.baseBranch, 'trunk');
    assert.equal(at('refused').saveBusy, false);
    assert.equal(at('refused').fields.baseBranch, 'trunk');
    assert.equal(at('refused').toasts.length, 1);
    assert.equal(at('retried').saveBusy, true);
    assert.equal(at('saved').saveBusy, false);
    assert.equal(at('saved').discard, false);
    assert.ok(at('saved').toasts.includes(msg(locale, 'settings.git.workflow.connected')));
    assert.deepEqual(at('saved').refreshed.at(-1), ['git-workflow', SITE]);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', saves: labelled(saves), statusReads: reads.length, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's GitWorkflow (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient, the status query and the save mutation; a fictional site and repository; every request answered by interception; no token typed; not the signed-in dashboard, production, the server or a real Git provider`,
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
