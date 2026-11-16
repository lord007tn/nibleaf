// Isolated component fixture of Settings → Git → Connect GitHub, step 1 (Authorize GitHub): main's GitWorkflow and its
// useAuthorizeGitWorkflow (before) and this branch's GitWorkflow and authorization command (after), with the real
// design system, EN/AR catalogs, the app's own QueryClient (wrapped to record which keys are invalidated) and the Git
// workflow status query, for fictional sites. Every API request is answered by interception on the fixture origin;
// an authorization POST can be held until the script answers it. Not the signed-in dashboard and not production. No
// server starts, and no request reaches GitHub: the tokens are fictional placeholders, and evidence.json writes each
// request body as a label (`<TOKEN_A>`), never the value.
//
// The before side is immutable: main's git-workflow.tsx and its whole features/site-git slice at BASE, and BASE's
// hooks/api/git-workflow.ts for useAuthorizeGitWorkflow (read with `git show`). Everything else it imports is checked
// to be unchanged since BASE, so neither side mixes in a module this branch changed.
//
// Run it while holding the repository's heavy-step lock; it takes no lock itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
/** A message by its id as the code names it (`settings.git.workflow.authorize`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://git-workflow-authorization.fixture.test';
/** The main commit this branch starts from (#791), pinned; evidence.json records it as `base`. */
const BASE = 'fc7f92e2c435d1017af4fb14233d3aac92870e25';
/** Fictional placeholders, long enough for the 20-character gate and nothing like a provider token. */
const TOKENS = { A: 'test-token-0001-placeholder', B: 'test-token-0002-placeholder' };
const tokenLabel = (value) => (value === TOKENS.A ? '<TOKEN_A>' : value === TOKENS.B ? '<TOKEN_B>' : value ? '<OTHER>' : '');
const ACCOUNTS = { A: { login: 'fixture-user-a', name: 'Fixture User A' }, B: { login: 'fixture-user-b', name: null } };
const REPOSITORY = 'acme-fixture/handbook';

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
// This branch removes useAuthorizeGitWorkflow from hooks/api/git-workflow.ts: the before side takes that file from
// BASE, and it is checked to have changed by nothing else.
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
const baseHooks = git('show', `${BASE}:${HOOKS}`);
assert.equal(git('diff', '--name-only', BASE, '--', ...SHARED, `:(exclude)${HOOKS}`), '', 'a module both sides share changed since BASE');
assert.ok(baseHooks.includes(AUTHORIZE_HOOK), 'BASE has useAuthorizeGitWorkflow');
assert.equal(
  (await readFile(resolve(root, HOOKS), 'utf8')).replaceAll('\r\n', '\n').trim(),
  baseHooks.replace(AUTHORIZE_HOOK, ''),
  'hooks/api/git-workflow.ts changed since BASE by more than the removal of useAuthorizeGitWorkflow',
);

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-workflow-authorization-capture-'));
  // Main's GitWorkflow, its features/site-git slice and its git-workflow hooks, as they are on the base.
  const slice = git('ls-tree', '-r', '--name-only', BASE, 'apps/app/src/features/site-git')
    .split('\n')
    .filter((file) => !/\.test\.tsx?$/.test(file));
  for (const file of slice) {
    const target = resolve(harness, 'before/site-git', file.replace('apps/app/src/features/site-git/', ''));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, git('show', `${BASE}:${file}`));
  }
  await writeFile(resolve(harness, 'before/git-workflow-hooks.ts'), baseHooks.replace(/from '\.\/([\w-]+)'/g, "from '@/hooks/api/$1'"));
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    "export * from '@/hooks/api';\nexport { useAuthorizeGitWorkflow } from './git-workflow-hooks';\n",
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
  // The settings page keys the Git tab by site (`git-${projectId}`). `refetchStatus` is any status read (Refresh, a
  // focus, another mutation's readback).
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
const fixture = window as unknown as { invalidated: unknown[]; refetchStatus?: () => void };
fixture.invalidated = [];
const invalidate = client.invalidateQueries.bind(client);
client.invalidateQueries = ((filters, options) => {
  fixture.invalidated.push(filters?.queryKey ?? null);
  return invalidate(filters, options);
}) as typeof client.invalidateQueries;
fixture.refetchStatus = () => void client.refetchQueries({ queryKey: ['git-workflow', 'site-a'] });
const Workflow = params.get('version') === 'before' ? Before : After;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
        <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Workflow key="git-site-a" projectId="site-a" /></main>
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
    define: { 'import.meta.env.VITE_APP_URL': JSON.stringify(origin) },
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

  /**
   * Opens the fixture on site A, not connected. The status GET answers null (not connected), or 403 once when
   * `server.failRead`. An authorization POST is recorded with its token as a label, held while `server.hold` (until
   * `server.release()`), refused with 400 if `server.refuse` (once), else answered with the token's fictional
   * account. Any other API call fails the run.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const held = [];
    const server = {
      hold: false,
      refuse: false,
      failRead: false,
      release: () => held.shift()?.(),
      held: () => held.length,
    };
    const json = (route, body, statusCode = 200) =>
      route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(body) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}`;
      if (call === 'GET /api/app/projects/site-a/git') {
        requests.push({ call });
        if (server.failRead) {
          server.failRead = false;
          return json(route, { error: { code: 'FORBIDDEN', message: 'No access.' } }, 403);
        }
        return json(route, { data: null });
      }
      if (call === 'POST /api/app/projects/site-a/git/authorize') {
        const body = JSON.parse(request.postData() ?? 'null');
        assert.deepEqual(Object.keys(body), ['token']);
        requests.push({ call, body: { token: tokenLabel(body.token) } });
        if (server.hold) await new Promise((done) => held.push(done));
        if (server.refuse) {
          server.refuse = false;
          return json(route, { error: { code: 'BAD_REQUEST', message: 'GitHub rejected the token.' } }, 400);
        }
        return json(route, { data: body.token === TOKENS.B ? ACCOUNTS.B : ACCOUNTS.A });
      }
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('#git2-token').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const settle = (page, ms = 300) => page.waitForTimeout(ms);
  const arrived = async (page, server, count = 1) => {
    for (let tries = 0; server.held() < count && tries < 100; tries += 1) await page.waitForTimeout(50);
    assert.ok(server.held() >= count);
  };
  const verifyButton = (page, locale) =>
    page.locator('button', {
      hasText: new RegExp(`${msg(locale, 'settings.git.workflow.authorize')}|${msg(locale, 'settings.git.workflow.authorizing')}`),
    });
  const type = (page, token) => page.locator('#git2-token').fill(token);
  const press = (page, locale) => verifyButton(page, locale).click();
  /** On step 2 (main after a stale answer), goes on to the review with a repository: the account the connection would use. */
  const toReview = async (page, locale) => {
    if (!(await page.locator('#git2-repo').count())) return;
    await page.locator('#git2-repo').fill(REPOSITORY);
    await page.locator('button', { hasText: msg(locale, 'settings.git.workflow.review') }).click();
    await settle(page);
  };
  const posts = (requests) => requests.filter(({ call }) => call.startsWith('POST'));
  /** What a reviewer should see: the step, the token field (as a label), Verify, the inline error, the account, toasts, refreshed keys. */
  const readback = (page, locale) =>
    page.evaluate(
      async ({ tokens, error, authorizedAs, verify }) => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const steps = [...document.querySelectorAll('ol > li')];
        const index = steps.findIndex((item) => item.getAttribute('aria-current') === 'step');
        const field = document.querySelector('#git2-token');
        const button = [...document.querySelectorAll('button')].find((item) => verify.some((text) => item.textContent?.includes(text)));
        const value = field?.value ?? null;
        return {
          dir: document.documentElement.dir,
          step: index === -1 ? null : index + 1,
          token: value === null ? null : value === tokens.A ? '<TOKEN_A>' : value === tokens.B ? '<TOKEN_B>' : value ? '<OTHER>' : '',
          tokenMasked: field ? getComputedStyle(field).getPropertyValue('-webkit-text-security') === 'disc' : null,
          verify: button ? { busy: button.getAttribute('aria-busy') === 'true', disabled: button.disabled } : null,
          inlineError: [...document.querySelectorAll('p')].filter((p) => p.textContent === error).length,
          account: [...document.querySelectorAll('span')].find((span) => span.textContent?.startsWith(authorizedAs))?.textContent ?? null,
          loadError: document.querySelector('[role="alert"]')?.textContent ?? null,
          toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
          invalidated: window.invalidated,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      },
      {
        tokens: TOKENS,
        error: msg(locale, 'settings.git.workflow.authorizeError'),
        authorizedAs: msg(locale, 'settings.git.workflow.authorizedAs'),
        verify: [msg(locale, 'settings.git.workflow.authorize'), msg(locale, 'settings.git.workflow.authorizing')],
      },
    );
  const refetchStatus = async (page) => {
    await page.evaluate(() => window.refetchStatus());
    await settle(page, 500);
  };

  /** Each state, run on both versions: what the person did before the screenshot. */
  const STATES = {
    ready: { label: 'Step 1, nothing typed', run: async () => undefined },
    success: {
      label: 'Token A, Authorize GitHub, verified (control)',
      run: async ({ page, locale }) => {
        await type(page, TOKENS.A);
        await press(page, locale);
        await settle(page, 600);
      },
    },
    refusal: {
      label: 'Token A, Authorize GitHub, refused (400) (control)',
      run: async ({ page, server, locale }) => {
        await type(page, TOKENS.A);
        server.refuse = true;
        await press(page, locale);
        await settle(page, 600);
      },
    },
    staleSuccess: {
      label: 'Token A checked (held), token edited to B, then A verified; on to the review if the wizard moved',
      run: async ({ page, server, locale }) => {
        await type(page, TOKENS.A);
        server.hold = true;
        await press(page, locale);
        await arrived(page, server);
        await type(page, TOKENS.B);
        server.hold = false;
        server.release();
        await settle(page, 600);
        server.tokenWhenAnswered = (await readback(page, locale)).token;
        await toReview(page, locale);
      },
    },
    staleRefusal: {
      label: 'Token A checked (held), token edited to B, then A refused (400)',
      run: async ({ page, server, locale }) => {
        await type(page, TOKENS.A);
        server.hold = true;
        server.refuse = true;
        await press(page, locale);
        await arrived(page, server);
        await type(page, TOKENS.B);
        server.hold = false;
        server.release();
        await settle(page, 600);
      },
    },
    sameTick: {
      label: 'Token A, Authorize GitHub pressed three times in one task (held)',
      run: async ({ page, server, locale }) => {
        await type(page, TOKENS.A);
        server.hold = true;
        await verifyButton(page, locale).evaluate((button) => {
          for (let press = 0; press < 3; press += 1) button.click();
        });
        await arrived(page, server);
        await settle(page);
      },
    },
    hiddenAnswer: {
      label: 'Token A checked (held), a status read fails (403) so the error replaces the wizard, A verified, Retry',
      run: async ({ page, server, locale }) => {
        await type(page, TOKENS.A);
        server.hold = true;
        await press(page, locale);
        await arrived(page, server);
        server.failRead = true;
        await refetchStatus(page);
        server.hidden = (await readback(page, locale)).step === null;
        server.hold = false;
        server.release();
        await settle(page, 600);
        await page.locator('button', { hasText: msg(locale, 'common.retry') }).click();
        await settle(page, 600);
      },
    },
  };

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const width of [390, 1440]) {
      const shots = {};
      const seen = {};
      for (const locale of ['en', 'ar']) {
        for (const [state, { run }] of Object.entries(STATES)) {
          for (const version of ['before', 'after']) {
            const context = await browser.newContext({ viewport: { width, height: 1100 }, reducedMotion: 'reduce', colorScheme: 'light' });
            const { page, errors, requests, server } = await open(context, { locale, version });
            await run({ page, server, locale });
            const read = await readback(page, locale);
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            assert.deepEqual(errors, []);
            if (read.tokenMasked !== null) assert.equal(read.tokenMasked, true, 'the token field is masked in every screenshot');
            await page.mouse.move(0, 0);
            shots[`${locale}-${state}-${version}`] = await page.locator('main').screenshot({ animations: 'disabled' });
            seen[`${locale}-${state}-${version}`] = {
              ...read,
              ...(server.tokenWhenAnswered !== undefined ? { tokenWhenAnswered: server.tokenWhenAnswered } : {}),
              ...(server.hidden !== undefined ? { wizardHiddenWhileHeld: server.hidden } : {}),
              requests: requests.map((item) => ({ ...item })),
            };
            server.hold = false;
            while (server.held()) server.release();
            await context.close();
          }
        }
        // The behaviour each sheet shows, asserted so a wrong capture fails the run.
        const at = (state, version) => seen[`${locale}-${state}-${version}`];
        const A = ['git-workflow', 'site-a'];
        const sentA = { call: 'POST /api/app/projects/site-a/git/authorize', body: { token: '<TOKEN_A>' } };
        for (const version of ['before', 'after']) {
          assert.equal(at('ready', version).step, 1);
          assert.equal(at('ready', version).verify.disabled, true);
          // Controls: a success refreshes site A and goes on to step 2; a refusal keeps the token and shows the error once.
          assert.deepEqual(posts(at('success', version).requests), [sentA]);
          assert.deepEqual(at('success', version).invalidated, [A]);
          assert.equal(at('success', version).step, 2);
          assert.deepEqual(posts(at('refusal', version).requests), [sentA]);
          assert.deepEqual([at('refusal', version).step, at('refusal', version).token, at('refusal', version).inlineError], [1, '<TOKEN_A>', 1]);
          assert.deepEqual(at('refusal', version).invalidated, []);
          // The request completes for its site either way.
          assert.deepEqual(posts(at('staleSuccess', version).requests), [sentA]);
          assert.deepEqual(at('staleSuccess', version).invalidated, [A]);
          assert.equal(at('hiddenAnswer', version).wizardHiddenWhileHeld, true);
          for (const state of Object.keys(STATES)) assert.deepEqual(at(state, version).toasts, []);
        }
        // Main: A's answer moves the wizard on while the field holds B, and the review names A's account.
        assert.equal(at('staleSuccess', 'before').tokenWhenAnswered, null);
        assert.equal(at('staleSuccess', 'before').step, 3);
        assert.match(at('staleSuccess', 'before').account, new RegExp(`@${ACCOUNTS.A.login}`));
        // Here the edit retired the check: step 1, B in the field, idle, no account.
        assert.deepEqual(
          [
            at('staleSuccess', 'after').step,
            at('staleSuccess', 'after').token,
            at('staleSuccess', 'after').verify.busy,
            at('staleSuccess', 'after').account,
          ],
          [1, '<TOKEN_B>', false, null],
        );
        // Main: A's refusal shows over B; here nothing.
        assert.deepEqual([at('staleRefusal', 'before').token, at('staleRefusal', 'before').inlineError], ['<TOKEN_B>', 1]);
        assert.deepEqual([at('staleRefusal', 'after').token, at('staleRefusal', 'after').inlineError], ['<TOKEN_B>', 0]);
        // Main: three POSTs for one check; here one.
        assert.equal(posts(at('sameTick', 'before').requests).length, 3);
        assert.deepEqual(posts(at('sameTick', 'after').requests), [sentA]);
        assert.equal(at('sameTick', 'after').verify.busy, true);
        // Main: the hidden answer is replayed (step 2 after Retry); here the wizard comes back on step 1.
        assert.equal(at('hiddenAnswer', 'before').step, 2);
        assert.deepEqual([at('hiddenAnswer', 'after').step, at('hiddenAnswer', 'after').verify.busy], [1, false]);
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(Math.min(width, 1024) * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const caption = (key) => {
        const { requests, toasts, invalidated, step, token, verify, inlineError, account, tokenWhenAnswered } = seen[key];
        const keys = invalidated.map((item) => JSON.stringify(item)).join(' ') || 'none';
        const sent = posts(requests)
          .map(({ body }) => body.token)
          .join(', ');
        const where = step === null ? 'wizard hidden' : `step ${step}`;
        return `${where}${token !== null ? ` · field ${token || 'empty'}` : ''}${tokenWhenAnswered !== undefined ? ` · field when answered ${tokenWhenAnswered ?? '(none: moved on)'}` : ''} · POSTs ${posts(requests).length}${sent ? ` [${sent}]` : ''} · Authorize ${verify ? (verify.busy ? 'busy' : verify.disabled ? 'disabled' : 'ready') : 'n/a'} · inline error ${inlineError} · account ${account ? account.replace(/^.*@/, '@') : 'none'} · refreshed ${keys} · toasts ${toasts.length}`;
      };
      const panel = (key) =>
        `<img src="data:image/png;base64,${shots[key].toString('base64')}" width="${shown}" style="display:block;border:1px solid #bbb"><div style="font-size:11px;margin-top:2px;max-width:${shown}px">${caption(key)}</div>`;
      const rows = (locale) =>
        Object.entries(STATES)
          .map(
            ([state, { label: text }]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${text}</b></div><div>${panel(`${locale}-${state}-before`)}</div><div>${panel(`${locale}-${state}-after`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Connect GitHub → Authorize · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional site, placeholder tokens (masked; shown here as labels), every request intercepted, nothing sent to GitHub</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (main ${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', states: seen });
    }

    // Token A → Authorize (held) → token edited to B → A answered (verified) → [main: on to the review] / [here:
    // Authorize again, the retry for B, held → verified → on to the review], on both versions.
    for (const version of ['before', 'after']) {
      const locale = 'en';
      const width = 1440;
      const file = `flow-${version}-${locale}-${width}.webm`;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
        recordVideo: { dir: harness, size: { width, height: 900 } },
      });
      const { page, errors, requests, server } = await open(context, { locale, version });
      const pause = (ms = 700) => page.waitForTimeout(ms);
      const steps = [];
      const note = async (step) => {
        steps.push({ step, ...(await readback(page, locale)), requests: requests.map((item) => ({ ...item })) });
      };
      await pause();
      await type(page, TOKENS.A);
      await pause();
      server.hold = true;
      await press(page, locale);
      await arrived(page, server);
      await pause();
      await note('token A, Authorize held');
      await type(page, TOKENS.B);
      await pause();
      await note('token edited to B while A is checked');
      server.release();
      await pause(1200);
      await note('A answered: verified');
      if (await page.locator('#git2-repo').count()) {
        await toReview(page, locale);
        await pause(1200);
        await note('on to the review');
      } else {
        await press(page, locale);
        await arrived(page, server);
        await pause();
        await note('Authorize again (B), held');
        server.hold = false;
        server.release();
        await pause(1200);
        await note('B answered: verified');
        await toReview(page, locale);
        await pause(1200);
        await note('on to the review');
      }
      await pause(800);
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, version, locale, width, theme: 'light', pageErrors: errors, steps });
    }
    const flow = (version, prefix) => recordings.find((item) => item.version === version).steps.find(({ step }) => step.startsWith(prefix));
    // Main: still busy after the edit, then moved on with A's account while the field held B.
    assert.equal(flow('before', 'token edited').verify.busy, true);
    assert.equal(flow('before', 'A answered').step, 2);
    assert.match(flow('before', 'on to the review').account, new RegExp(`@${ACCOUNTS.A.login}`));
    // Here: the edit retired the check, A's answer changed nothing, and the retry for B moved on with B's account.
    assert.equal(flow('after', 'token edited').verify.busy, false);
    assert.deepEqual([flow('after', 'A answered').step, flow('after', 'A answered').token], [1, '<TOKEN_B>']);
    assert.equal(flow('after', 'Authorize again').verify.busy, true);
    assert.match(flow('after', 'on to the review').account, new RegExp(`@${ACCOUNTS.B.login}`));
    assert.deepEqual(
      posts(flow('after', 'on to the review').requests).map(({ body }) => body.token),
      ['<TOKEN_A>', '<TOKEN_B>'],
    );

    assert.equal(attempted.length, 0);
    const evidence = {
      environment: `Component fixture: main's GitWorkflow, its features/site-git slice and useAuthorizeGitWorkflow (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient (invalidations recorded) and the Git workflow status query; each authorization POST answered by interception (a fictional account, or a 400), optionally held; a fictional site; placeholder tokens written as <TOKEN_A>/<TOKEN_B> labels and masked on screen; not the signed-in dashboard, production, the server or GitHub`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      recordings,
    };
    const written = JSON.stringify(evidence);
    for (const token of Object.values(TOKENS)) assert.ok(!written.includes(token), 'no token value in evidence.json');
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), evidence);
  });
  console.log(`${captures.length} before/after sheets and ${recordings.length} recordings; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    // Windows may hold the recording open for a moment after the browser closes.
    await rm(harness, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
