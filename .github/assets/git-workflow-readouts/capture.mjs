// Isolated component fixture of Settings → Git, connected: main's GitWorkflow with its inline status header, pull
// request previews and recent operations (before), and this branch's GitWorkflow with the extracted readouts
// (after), with the real design system, EN/AR catalogs, the app's QueryClient and the status query, for a fictional
// site and repository. Every API request is answered by interception on the fixture origin. Not the signed-in
// dashboard and not production. No server starts, and nothing is read from any Git provider.
//
// The before side is immutable: main's git-workflow.tsx and its whole features/site-git slice at BASE (read with
// `git show`). Everything else it imports is checked to be unchanged since BASE, so neither side mixes in a module
// this branch changed; main's hooks/api/git-workflow.ts, which lost useAuthorizeGitWorkflow later, is read at BASE too.
//
// Run it while holding the repository's heavy-step lock; it takes no lock itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
/** A message by its id as the code names it (`settings.git.workflow.title`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://git-workflow-readouts.fixture.test';
/** The main commit this branch starts from (#788), pinned; evidence.json records it as `base`. */
const BASE = 'a804d679a214b470a6e2c24646b468d4f1cf0e22';
const SITE = 'site-1';
const STATUS = `GET /api/app/projects/${SITE}/git`;

const operation = (id, fields) => ({
  id,
  kind: 'PULL',
  status: 'SUCCEEDED',
  commitMessage: null,
  changedFiles: null,
  pullRequestNo: null,
  pullRequestUrl: null,
  error: null,
  createdAt: '2026-11-15T09:00:00.000Z',
  conflicts: [],
  ...fields,
});
const pull = (id, fields) => ({
  id,
  number: 1,
  url: `https://git.acme-fixture.test/handbook/pull/${id}`,
  title: 'Handbook refresh',
  draft: false,
  state: 'open',
  previews: [],
  ...fields,
});
const connection = (fields) => ({
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
  operations: [],
  pullRequests: [],
  files: [],
  ...fields,
});
/** The same fictional statuses as git-workflow-readouts.test.tsx. No operation is queued or running, so nothing polls. */
const SCENARIOS = {
  empty: connection({ lastSyncStatus: 'IDLE', lastSyncedAt: null }),
  mixed: connection({
    repository: 'acme-fixture/دليل',
    operations: [
      operation('op-1', {
        kind: 'PUSH',
        commitMessage: 'تحديث الدليل',
        changedFiles: [
          { path: 'docs/دليل/مقدمة.mdx', status: 'modified' },
          { path: 'docs/guide.mdx', status: 'added' },
        ],
        createdAt: '2026-11-14T08:30:00.000Z',
      }),
      operation('op-3', { changedFiles: [], createdAt: '2026-11-13T23:59:59.000Z' }),
      operation('op-4', { kind: 'PUSH', status: 'FAILED', commitMessage: 'Fixture message', error: 'Bad credentials: provider trace' }),
      operation('op-5', {
        status: 'CONFLICT',
        changedFiles: [{ path: 'docs/a.mdx', status: 'conflict' }],
        error: 'rejected: non-fast-forward',
        createdAt: '2026-01-02T03:04:05.000Z',
      }),
      operation('op-6', { kind: 'PUSH', status: 'READY' }),
      operation('op-7', { kind: 'REBASE', status: 'PAUSED', error: 'ProviderError: something odd' }),
    ],
    pullRequests: [
      pull('pr-1', { number: 12 }),
      pull('pr-2', { number: 7, title: 'مسودة الدليل', draft: true, previews: [{ id: 'pv-1', status: 'BUILDING', url: null, error: null }] }),
      pull('pr-3', {
        number: 3,
        state: 'closed',
        previews: [
          { id: 'pv-9', status: 'FAILED', url: null, error: 'build failed' },
          { id: 'pv-2', status: 'READY', url: 'https://preview.acme-fixture.test/pr-3', error: null },
        ],
      }),
      pull('pr-4', {
        number: 4,
        state: 'merged',
        previews: [
          { id: 'pv-5', status: 'READY', url: 'https://preview.acme-fixture.test/pr-4', error: null },
          { id: 'pv-4', status: 'BUILDING', url: null, error: null },
        ],
      }),
      pull('pr-5', { number: 5, previews: [{ id: 'pv-6', status: 'WAITING', url: 'https://preview.acme-fixture.test/pr-5', error: null }] }),
      pull('pr-6', { number: 6, title: 'Closed draft', draft: true, state: 'closed' }),
    ],
  }),
  failure: connection({
    lastSyncStatus: 'FAILED',
    lastSyncError: 'Bad credentials: provider trace',
    operations: [operation('op-8', { status: 'FAILED', error: 'fetch failed' })],
  }),
};
/** What each sheet row shows: a scenario in a panel (the history shows on Overview and Sync, the previews on Overview and Update PR). */
const STATES = [
  ['empty', 'overview', 'Empty: unknown last-sync status, no pull request, no operation'],
  ['mixed', 'overview', 'Mixed: previews (first listed) and history in the order given, Arabic titles and paths'],
  ['failure', 'overview', 'Last sync failed, operation failed (FailureMessage, details collapsed)'],
];

/** Everything main's GitWorkflow imports outside its features/site-git slice: unchanged since BASE, or the before side would mix. */
const SHARED = [
  'apps/app/src/hooks/api',
  'apps/app/src/components/failure-message.tsx',
  'apps/app/src/components/secret-input.tsx',
  'apps/app/src/lib',
  'apps/app/src/env.ts',
  'apps/app/src/services',
  'apps/app/src/integrations/tanstack-query',
  'packages/design-system/src',
  'packages/i18n',
  'packages/validators/src',
  'packages/shared/src',
];
// Later changes to them, all in hooks/api/git-workflow.ts: useAuthorizeGitWorkflow and useConnectGitWorkflow left it,
// and the status gained its import targets. The before side takes that file from BASE, and it is checked to have
// changed by nothing else.
const HOOKS = 'apps/app/src/hooks/api/git-workflow.ts';
const AUTHORIZE_HOOK = [
  '// Authorizing stores the credential, which the status shows (`credentialConfigured`).',
  'export const useAuthorizeGitWorkflow = (projectId: string) =>',
  '  useGitWorkflowMutation(projectId, async (token: string) =>',
  '    mutateData(',
  "      await api.app.projects[':projectId'].git.authorize.$post({ param: { projectId }, json: { token } }),",
  "      'Could not authorize the GitHub account.',",
  '    ),',
  '  );',
  '',
  '',
].join('\n');
const CONNECT_IMPORT = "import type { GitConnectionBody } from '@nibleaf/validators';\n";
const CONNECT_HOOK = [
  'export const useConnectGitWorkflow = (projectId: string) =>',
  '  useGitWorkflowMutation(projectId, async (json: GitConnectionBody) =>',
  "    mutateData(await api.app.projects[':projectId'].git.connection.$put({ param: { projectId }, json }), 'Could not connect the repository.'),",
  '  );',
  '',
  '',
].join('\n');
// The status's import targets (#797), a type only.
const IMPORT_TARGETS = [
  "  /** The Nibleaf branch and language the connection syncs; null for the site's default. */",
  '  importBranchId: string | null;',
  '  importLanguageId: string | null;',
  '',
].join('\n');
const baseHooks = git('show', `${BASE}:${HOOKS}`);
assert.equal(git('diff', '--name-only', BASE, '--', ...SHARED, `:(exclude)${HOOKS}`), '', 'a module both sides share changed since BASE');
assert.ok(baseHooks.includes(AUTHORIZE_HOOK) && baseHooks.includes(CONNECT_IMPORT) && baseHooks.includes(CONNECT_HOOK), 'BASE has both hooks');
assert.equal(
  (await readFile(resolve(root, HOOKS), 'utf8')).replaceAll('\r\n', '\n').trim(),
  baseHooks
    .replace(CONNECT_IMPORT, '')
    .replace('  contentPath: string;\n', `  contentPath: string;\n${IMPORT_TARGETS}`)
    .replace(AUTHORIZE_HOOK, '')
    .replace(CONNECT_HOOK, ''),
  'hooks/api/git-workflow.ts changed since BASE by more than those later changes',
);

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-workflow-readouts-capture-'));
  // Main's GitWorkflow and its features/site-git slice, as they are on the base.
  const slice = git('ls-tree', '-r', '--name-only', BASE, 'apps/app/src/features/site-git')
    .split('\n')
    .filter((file) => !/\.test\.tsx?$/.test(file));
  for (const file of slice) {
    const target = resolve(harness, 'before/site-git', file.replace('apps/app/src/features/site-git/', ''));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, git('show', `${BASE}:${file}`));
  }
  // Main's git-workflow hooks, for useAuthorizeGitWorkflow (gone from the app); every other hook is today's, unchanged.
  await writeFile(resolve(harness, 'before/git-workflow-hooks.ts'), baseHooks.replace(/from '\.\/([\w-]+)'/g, "from '@/hooks/api/$1'"));
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    "export * from '@/hooks/api';\nexport { useAuthorizeGitWorkflow, useConnectGitWorkflow } from './git-workflow-hooks';\n",
  );
  await writeFile(
    resolve(harness, 'before/git-workflow.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/git-workflow.tsx`)
      .replaceAll("from '@/features/site-git/", "from './site-git/")
      .replace("from '@/hooks/api'", "from './hooks'"),
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
window.__client = client;
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

  /** Opens the fixture with `data` as the status. A read is answered at once, or held while `server.hold` until `server.release()`. */
  async function open(context, { locale, version, data }) {
    const page = await context.newPage();
    const errors = [];
    const reads = [];
    const held = [];
    const server = { hold: false, release: () => held.shift()?.(), held: () => held.length };
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === STATUS) {
        reads.push(call);
        if (server.hold) await new Promise((done) => held.push(done));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('nav button[aria-pressed]').first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, reads, server };
  }

  const refreshButton = (page, locale) => page.getByRole('button', { name: msg(locale, 'common.refresh'), exact: true });
  /** The readouts and their surroundings as a reviewer would check them: markup digests, the Refresh button, links, focus, observers. */
  const state = async (page, locale) =>
    page.evaluate(
      ({ title, previewsTitle, historyTitle, refresh }) => {
        const section = (tag, text) =>
          [...document.querySelectorAll(tag)].find((heading) => heading.textContent === text)?.closest('section') ?? null;
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === refresh);
        const queries = window.__client.getQueryCache().getAll();
        return {
          dir: document.documentElement.dir,
          main: document.querySelector('main').innerHTML,
          header: section('h2', title)?.outerHTML ?? null,
          previews: section('h3', previewsTitle)?.outerHTML ?? null,
          history: section('h3', historyTitle)?.outerHTML ?? null,
          refresh: {
            busy: button.getAttribute('aria-busy') === 'true',
            disabled: button.disabled,
            focused: document.activeElement === button,
            name: button.textContent.trim(),
          },
          focusOnBody: document.activeElement === document.body,
          links: [...document.querySelectorAll('main a')].map((link) => ({
            name: link.textContent,
            href: link.getAttribute('href'),
            target: link.getAttribute('target'),
            rel: link.getAttribute('rel'),
          })),
          queries: queries.map((query) => ({ key: query.queryKey, observers: query.observers.length })),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      },
      {
        title: msg(locale, 'settings.git.workflow.title'),
        previewsTitle: msg(locale, 'settings.git.workflow.previewsTitle'),
        historyTitle: msg(locale, 'settings.git.workflow.recentOperations'),
        refresh: msg(locale, 'common.refresh'),
      },
    );
  /** Evidence keeps digests of the markup, not the markup itself. */
  const digest = ({ main, header, previews, history, ...rest }) => ({
    ...rest,
    sha256: { main: sha256(main), header: header && sha256(header), previews: previews && sha256(previews), history: history && sha256(history) },
  });

  const captures = [];
  const keyboard = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    const newContext = (width) =>
      browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light', timezoneId: 'UTC' });
    for (const width of [390, 1440]) {
      const sheets = {};
      const seenByLocale = {};
      for (const locale of ['en', 'ar']) {
        const shots = {};
        const seenBy = {};
        for (const [scenario, intent] of STATES) {
          const key = `${scenario}-${intent}`;
          const seen = {};
          for (const version of ['before', 'after']) {
            const context = await newContext(width);
            const { page, errors, reads } = await open(context, { locale, version, data: SCENARIOS[scenario] });
            await page.waitForTimeout(300);
            seen[version] = await state(page, locale);
            assert.equal(seen[version].dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(seen[version].overflow, false, `${version} ${key} overflows at ${width}px`);
            assert.deepEqual(errors, []);
            seen[version].statusReads = reads.length;
            const element = page.locator('main');
            shots[`${version}-${key}`] = await element.screenshot({ animations: 'disabled' });
            seen[version].pixels = sha256(await page.screenshot({ fullPage: true, animations: 'disabled' }));
            await context.close();
          }
          // Identical output: the whole connected screen's markup, each readout, the links, the query and its observer.
          assert.equal(seen.after.main, seen.before.main, `${key} (${locale}, ${width}px) markup differs`);
          assert.deepEqual(digest(seen.after), digest(seen.before));
          assert.equal(seen.after.pixels, seen.before.pixels, `${key} (${locale}, ${width}px) pixels differ`);
          assert.deepEqual(seen.after.queries, [{ key: ['git-workflow', SITE], observers: 1 }]);
          assert.equal(seen.after.statusReads, 1);
          seenBy[key] = { before: digest(seen.before), after: digest(seen.after) };
        }
        seenByLocale[locale] = seenBy;
        sheets[locale] = shots;
      }

      // Refresh from the keyboard, the status read held: Enter, then Space once it is idle again.
      for (const locale of ['en', 'ar']) {
        const steps = {};
        for (const version of ['before', 'after']) {
          const context = await newContext(width);
          const { page, errors, reads, server } = await open(context, { locale, version, data: SCENARIOS.failure });
          // Read after two frames: Chrome moves focus off a button that became disabled at its next rendering step.
          const note = async (step) => {
            await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
            const { refresh, focusOnBody } = await state(page, locale);
            return { step, statusReads: reads.length, refresh, focusOnBody };
          };
          const log = [];
          server.hold = true;
          await refreshButton(page, locale).focus();
          log.push(await note('focused'));
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]'));
          log.push(await note('Enter: reading (held)'));
          await page.keyboard.press('Enter');
          await page.waitForTimeout(200);
          log.push(await note('Enter again while busy'));
          server.release();
          await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
          log.push(await note('read answered'));
          await refreshButton(page, locale).focus();
          await page.keyboard.press('Space');
          await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]'));
          log.push(await note('Space: reading (held)'));
          server.release();
          await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
          log.push(await note('read answered'));
          assert.deepEqual(errors, []);
          assert.deepEqual(
            log.map(({ statusReads }) => statusReads),
            [1, 2, 2, 2, 3, 3],
          );
          steps[version] = log;
          await context.close();
        }
        assert.deepEqual(steps.after, steps.before);
        keyboard.push({ width, locale, steps: steps.after });
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(width * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const panel = (locale, key) =>
        `<img src="data:image/png;base64,${sheets[locale][key].toString('base64')}" width="${shown}" style="display:block;border:1px solid #bbb">`;
      const rows = (locale) =>
        STATES.map(
          ([scenario, intent, label]) =>
            `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(locale, `before-${scenario}-${intent}`)}</div><div>${panel(locale, `after-${scenario}-${intent}`)}</div>`,
        ).join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git, connected, Overview · ${width}px${scale < 1 ? ' (shown at 50%)' : ''} · fictional site and repository, every request intercepted · markup and pixels identical in every row</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', timezone: 'UTC', ...seenByLocale });
    }

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's GitWorkflow and its features/site-git slice (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient and the status query; a fictional site and repository; every request answered by interception; not the signed-in dashboard, production, the server or a Git provider`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      // Paths both sides import from the working tree, with no change since BASE.
      unchangedSinceBase: SHARED,
      attempted: attempted.length,
      captures,
      keyboard,
    });
  });
  console.log(
    `${captures.length} before/after sheets, identical markup and pixels; keyboard Refresh identical; no overflow, page errors or outside requests`,
  );
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
