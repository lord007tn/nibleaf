// Isolated component fixture of Settings → Git → Sync and Update PR: main's
// GitWorkflow with its useQueueGitOperation (before) and this branch's (after),
// with the real design system, EN/AR catalogs, the app's QueryClient, the status
// query and the operation mutation, for a fictional site and repository. Every
// API request is answered by interception on the fixture origin, held until the
// script answers it. Not the signed-in dashboard and not production. No server
// starts, and nothing is pulled, pushed or opened on any Git provider.
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
/** A message by its id as the code names it (`settings.git.workflow.updatePr`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://git-workflow.fixture.test';
/** The main commit this branch starts from (#785), pinned; evidence.json records it as `base`. */
const BASE = '5c7426c6fe121700e303684ccc12b1dfa1f62ab0';
const SITE = 'site-1';
const STATUS = `GET /api/app/projects/${SITE}/git`;
const OPERATION = `POST /api/app/projects/${SITE}/git/operations`;
/** A fictional connection, last synced, with no open conflict. */
const CONNECTION = {
  id: 'connection-1',
  repository: 'acme-fixture/handbook',
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncStatus: 'SUCCEEDED',
  lastSyncError: null,
  lastSyncedAt: '2026-11-15T09:00:00.000Z',
  operations: [
    {
      id: 'operation-0',
      kind: 'PULL',
      status: 'SUCCEEDED',
      commitMessage: null,
      changedFiles: [{ path: 'docs/intro.mdx', status: 'modified' }],
      pullRequestNo: null,
      pullRequestUrl: null,
      error: null,
      createdAt: '2026-11-15T09:00:00.000Z',
      conflicts: [],
    },
  ],
  pullRequests: [],
  files: [],
};
const QUEUED = (kind) => ({ data: { ...CONNECTION.operations[0], id: 'operation-new', kind, status: 'QUEUED', changedFiles: null } });
/** A refusal the fixture invents (no Git provider is reached); the panel maps it to its own message. */
const REFUSED = { status: 503, body: { error: { message: 'Refused by the fixture.' } } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const syncBody = { kind: 'PULL', sourceRef: 'main' };
/** Update PR's fields as the fixture types them (spaces kept: nothing is trimmed). */
const TYPED = {
  commitMessage: '  Refresh the handbook ',
  authorName: 'Ada Example',
  authorEmail: 'ada@acme-fixture.test',
  pullRequestTitle: 'Handbook refresh',
};
const pushBody = { kind: 'PUSH', ...TYPED, createPullRequest: true };
/** A request's body without its key, which the evidence checks separately. */
const unkeyed = ({ idempotencyKey: _key, ...body }) => body;

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-workflow-capture-'));
  // Main's component and its operation and conflict hooks as they are on the base (both are gone from the app).
  await mkdir(resolve(harness, 'before'), { recursive: true });
  await writeFile(
    resolve(harness, 'before/git-workflow.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/git-workflow.tsx`).replace("from '@/hooks/api'", "from './hooks'"),
  );
  await writeFile(
    resolve(harness, 'before/git-workflow-hooks.ts'),
    git('show', `${BASE}:apps/app/src/hooks/api/git-workflow.ts`).replace(/from '\.\/([\w-]+)'/g, "from '@/hooks/api/$1'"),
  );
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    "export * from '@/hooks/api';\nexport { useQueueGitOperation, useResolveGitConflict } from './git-workflow-hooks';\n",
  );
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
   * Opens the fixture. An operation POST waits `server.delay` ms, or, with `server.hold`, until `server.release()`;
   * then it is answered with `server.answers.shift()` or as queued. Every status read is answered at once.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const reads = [];
    const held = [];
    const server = { delay: 0, hold: false, answers: [], release: () => held.shift()?.(), held: () => held.length };
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === STATUS) {
        reads.push(call);
        return json(route, { data: CONNECTION });
      }
      if (call === OPERATION) {
        const body = request.postDataJSON();
        requests.push({ call, body });
        if (server.hold) await new Promise((done) => held.push(done));
        else await wait(server.delay);
        const answer = server.answers.shift();
        return answer ? json(route, answer.body, answer.status) : json(route, QUEUED(body.kind));
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('nav button[aria-pressed]').first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, reads, server };
  }

  const nav = (page, locale, intent) => page.locator('nav button[aria-pressed]', { hasText: msg(locale, `settings.git.workflow.nav.${intent}`) });
  const syncButton = (page, locale) => page.locator('button', { hasText: msg(locale, 'settings.git.workflow.syncLatest') });
  const updatePrButton = (page, locale) => page.locator('button', { hasText: msg(locale, 'settings.git.workflow.updatePr') });
  const typeUpdatePr = async (page) => {
    await page.locator('#git2-message').fill(TYPED.commitMessage);
    await page.locator('#git2-author').fill(TYPED.authorName);
    await page.locator('#git2-email').fill(TYPED.authorEmail);
    await page.locator('#git2-title').fill(TYPED.pullRequestTitle);
  };
  /** Waits until `count` operation requests have arrived (and checks no more did). */
  const waitForRequests = async (page, requests, count) => {
    for (let tries = 0; requests.length < count && tries < 100; tries += 1) await page.waitForTimeout(50);
    await page.waitForTimeout(200);
    assert.equal(requests.length, count);
  };
  /** Two presses in one task, before React renders the busy button. */
  const pressTwice = (page, label) =>
    page.evaluate((text) => {
      const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
      button.click();
      button.click();
    }, label);
  /** What a reviewer should see: the panel, the operation button (busy, disabled, focus), the Update PR fields, toasts and refreshes. */
  const state = async (page, locale) =>
    page.evaluate(
      ({ syncLabel, updatePrLabel }) => {
        const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
        const find = (label) => [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(label));
        const read = (button) =>
          button && {
            busy: button.getAttribute('aria-busy') === 'true',
            disabled: button.disabled,
            ariaDisabled: button.getAttribute('aria-disabled') === 'true',
            focused: document.activeElement === button,
          };
        return {
          dir: document.documentElement.dir,
          panel: text(document.querySelector('nav button[aria-pressed="true"] span')),
          syncButton: read(find(syncLabel)),
          updatePrButton: read(find(updatePrLabel)),
          commitMessage: document.querySelector('#git2-message')?.value ?? null,
          focusLost: document.activeElement === document.body,
          toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
          refreshed: window.__refreshed,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      },
      { syncLabel: msg(locale, 'settings.git.workflow.syncLatest'), updatePrLabel: msg(locale, 'settings.git.workflow.updatePr') },
    );
  const siteRefresh = [['git-workflow', SITE]];
  const keysOf = (requests) => requests.map(({ body }) => body.idempotencyKey);
  /** The evidence names each idempotency key by a label in order of first use (same key, same label), never the raw UUID. */
  const keyLabels = new Map();
  const labelled = (requests) =>
    requests.map(({ call, body }) => {
      if (!keyLabels.has(body.idempotencyKey)) keyLabels.set(body.idempotencyKey, `<idempotency#${keyLabels.size + 1}>`);
      return { call, body: { ...body, idempotencyKey: keyLabels.get(body.idempotencyKey) } };
    });

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
        const shoot = async (key, page, { requests, reads, errors }) => {
          await page.waitForTimeout(300);
          const seen = await state(page, locale);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.overflow, false, `${key} overflows at ${width}px`);
          assert.deepEqual(errors, []);
          shots[key] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          seenBy[key] = { ...seen, requests: labelled(requests), statusReads: reads.length };
          return seen;
        };
        const after = (version) => version === 'after';
        for (const version of ['before', 'after']) {
          // Sync ready, then Sync pressed twice in one task (from the keyboard focus) while the request is held.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version });
            const { page, requests, server } = opened;
            server.hold = true;
            await nav(page, locale, 'sync').click();
            const ready = await shoot(`${version}-ready`, page, opened);
            assert.equal(ready.syncButton.busy, false);
            await syncButton(page, locale).focus();
            await pressTwice(page, msg(locale, 'settings.git.workflow.syncLatest'));
            await waitForRequests(page, requests, after(version) ? 1 : 2);
            const pressed = await shoot(`${version}-syncPressed`, page, opened);
            assert.equal(pressed.syncButton.busy, true);
            assert.deepEqual(
              requests.map(({ body }) => unkeyed(body)),
              after(version) ? [syncBody] : [syncBody, syncBody],
            );
            assert.ok(keysOf(requests).every((key) => UUID.test(key)));
            assert.equal(new Set(keysOf(requests)).size, requests.length);
            while (server.held()) server.release();
            await context.close();
          }
          // Update PR typed, then pressed twice in one task while held.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version });
            const { page, requests, server } = opened;
            server.hold = true;
            await nav(page, locale, 'publish').click();
            await typeUpdatePr(page);
            await pressTwice(page, msg(locale, 'settings.git.workflow.updatePr'));
            await waitForRequests(page, requests, after(version) ? 1 : 2);
            const pressed = await shoot(`${version}-updatePrPressed`, page, opened);
            assert.equal(pressed.updatePrButton.busy, true);
            assert.deepEqual(
              requests.map(({ body }) => unkeyed(body)),
              after(version) ? [pushBody] : [pushBody, pushBody],
            );
            while (server.held()) server.release();
            await context.close();
          }
          // Sync running, Update PR chosen and typed (busy in both, as before), then Sync is refused: main toasts
          // the refusal over the Update PR panel; here nothing is reported there.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version });
            const { page, requests, server } = opened;
            server.hold = true;
            server.answers.push(REFUSED);
            await nav(page, locale, 'sync').click();
            await syncButton(page, locale).click();
            await waitForRequests(page, requests, 1);
            await nav(page, locale, 'publish').click();
            await typeUpdatePr(page);
            const running = await state(page, locale);
            assert.equal(running.updatePrButton.busy, true);
            server.release();
            if (after(version))
              await page.waitForFunction(
                (label) =>
                  [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(label))?.getAttribute('aria-busy') !== 'true',
                msg(locale, 'settings.git.workflow.updatePr'),
              );
            else await page.locator('[data-sonner-toast]').first().waitFor();
            const stale = await shoot(`${version}-staleError`, page, opened);
            assert.equal(stale.updatePrButton.busy, false);
            assert.equal(stale.commitMessage, TYPED.commitMessage);
            assert.deepEqual(stale.toasts, after(version) ? [] : [msg(locale, 'settings.git.workflow.operationError')]);
            assert.deepEqual(stale.refreshed, []);
            await context.close();
          }
        }
        // Keyboard focus while busy is the same before and after.
        assert.equal(seenBy['before-syncPressed'].syncButton.focused, seenBy['after-syncPressed'].syncButton.focused);
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
          ['ready', 'Sync ready (unchanged)'],
          ['syncPressed', 'Sync pressed twice in one task, request held: two operations before, one after'],
          ['updatePrPressed', 'Update PR typed and pressed twice in one task, held: two operations before, one after'],
          ['staleError', 'Sync running, Update PR chosen and typed, then Sync refused: before toasts over Update PR'],
        ]
          .map(
            ([key, label]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(locale, `before-${key}`)}</div><div>${panel(locale, `after-${key}`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Sync / Update PR · ${width}px${scale < 1 ? ' (shown at 50%)' : ''} · fictional site and repository, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', ...seenByLocale });
    }

    // Sync held then refused → explained once → retried (same body, a new key) → queued, the site's status read
    // again → Update PR typed and sent → queued.
    const locale = 'en';
    const width = 1440;
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 900 } },
    });
    const { page, errors, requests, reads, server } = await open(context, { locale, version: 'after' });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page, locale)), requestsSoFar: requests.length, statusReads: reads.length });
    server.delay = 1500;
    await nav(page, locale, 'sync').click();
    await pause();
    await note('Sync ready');
    server.answers.push(REFUSED);
    await syncButton(page, locale).click();
    await pause(400);
    await note('syncing (held 1.5 s): busy');
    await pause(1800);
    await note('refused: explained once, nothing refreshed');
    await pause(1200);
    await syncButton(page, locale).click();
    await pause(400);
    await note('retried: busy');
    await pause(1800);
    await note('queued: the site status read again');
    await pause(800);
    await nav(page, locale, 'publish').click();
    await typeUpdatePr(page);
    await pause();
    await updatePrButton(page, locale).click();
    await pause(400);
    await note('Update PR sending: busy');
    await pause(1800);
    await note('Update PR queued: fields kept, no success toast');
    await pause(1200);

    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    assert.deepEqual(
      requests.map(({ call, body }) => ({ call, body: unkeyed(body) })),
      [
        { call: OPERATION, body: syncBody },
        { call: OPERATION, body: syncBody },
        { call: OPERATION, body: pushBody },
      ],
    );
    assert.ok(keysOf(requests).every((key) => UUID.test(key)));
    assert.equal(new Set(keysOf(requests)).size, 3);
    assert.equal(at('syncing').syncButton.busy, true);
    assert.deepEqual(at('refused').toasts, [msg(locale, 'settings.git.workflow.operationError')]);
    assert.equal(at('refused').syncButton.busy, false);
    assert.deepEqual(at('refused').refreshed, []);
    assert.equal(at('retried').syncButton.busy, true);
    assert.deepEqual(at('queued').refreshed, siteRefresh);
    assert.equal(at('queued').statusReads, at('refused').statusReads + 1);
    assert.equal(at('Update PR sending').updatePrButton.busy, true);
    assert.equal(at('Update PR queued').updatePrButton.busy, false);
    assert.equal(at('Update PR queued').commitMessage, TYPED.commitMessage);
    assert.deepEqual(at('Update PR queued').refreshed, [...siteRefresh, ...siteRefresh]);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests: labelled(requests), statusReads: reads.length, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's GitWorkflow and its useQueueGitOperation (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient, the status query and the operation mutation; a fictional site and repository; every request answered by interception; not the signed-in dashboard, production, the server's Git worker or a real Git provider`,
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
