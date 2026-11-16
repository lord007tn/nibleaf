// Isolated component fixture of Settings → Git → Connect GitHub, step 3 (Connect): main's GitWorkflow and its
// useConnectGitWorkflow (before) and this branch's GitWorkflow and first-connect command (after), with the real design
// system, EN/AR catalogs, the app's own QueryClient (wrapped to record which keys are invalidated) and the Git workflow
// status query, for fictional sites. Every API request is answered by interception on the fixture origin; a Connect
// PUT can be held until the script answers it. Not the signed-in dashboard and not production. No server starts, and
// no request reaches GitHub: the tokens and webhook secrets are fictional low-entropy placeholders, masked on screen
// (the token field by the app, the secret by the fixture's own style), and evidence.json writes each as a label
// (`<TOKEN_A>`, `<SECRET_1>`), never the value.
//
// The before side is immutable: main's git-workflow.tsx and its whole features/site-git slice at BASE, and BASE's
// hooks/api/git-workflow.ts for useConnectGitWorkflow (read with `git show`). Everything else it imports is checked to
// be unchanged since BASE, so neither side mixes in a module this branch changed.
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
/** A message by its id as the code names it (`settings.git.workflow.connect`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://git-workflow-first-connect.fixture.test';
/** The main commit this branch starts from (#797), pinned; evidence.json records it as `base`. */
const BASE = 'dd302202092fbb2775df3f0c7605086c7225bc16';
/** Fictional placeholders: long enough for step 1's 20-character gate, nothing like a provider token or secret. */
const TOKEN = 'test-token-0001-placeholder';
const SECRETS = ['test-secret-0001', 'test-secret-0002'];
const label = (value) =>
  value === TOKEN ? '<TOKEN_A>' : SECRETS.includes(value) ? `<SECRET_${SECRETS.indexOf(value) + 1}>` : value ? '<OTHER>' : '';
const ACCOUNT = { login: 'fixture-user', name: 'Fixture User' };
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
// This branch removes useConnectGitWorkflow (and the type import only it used) from hooks/api/git-workflow.ts: the
// before side takes that file from BASE, and it is checked to have changed by nothing else.
const HOOKS = 'apps/app/src/hooks/api/git-workflow.ts';
const REMOVED = [
  "import type { GitConnectionBody } from '@nibleaf/validators';\n",
  [
    'export const useConnectGitWorkflow = (projectId: string) =>',
    '  useGitWorkflowMutation(projectId, async (json: GitConnectionBody) =>',
    "    mutateData(await api.app.projects[':projectId'].git.connection.$put({ param: { projectId }, json }), 'Could not connect the repository.'),",
    '  );',
    '',
    '',
  ].join('\n'),
];
const baseHooks = git('show', `${BASE}:${HOOKS}`);
assert.equal(git('diff', '--name-only', BASE, '--', ...SHARED, `:(exclude)${HOOKS}`), '', 'a module both sides share changed since BASE');
for (const part of REMOVED) assert.ok(baseHooks.includes(part), 'BASE has useConnectGitWorkflow');
assert.equal(
  (await readFile(resolve(root, HOOKS), 'utf8')).replaceAll('\r\n', '\n').trim(),
  REMOVED.reduce((hooks, part) => hooks.replace(part, ''), baseHooks),
  'hooks/api/git-workflow.ts changed since BASE by more than the removal of useConnectGitWorkflow',
);

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-workflow-first-connect-capture-'));
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
    "export * from '@/hooks/api';\nexport { useConnectGitWorkflow, useDisconnectGitWorkflow, useGitWorkflow, useRotateGitWorkflowWebhookSecret } from './git-workflow-hooks';\n",
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
  // The secret mask: the fixture's own style, never the app's. The one-time secret's text is hidden and a label shown.
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-git";\n@source "../src/components";\n@source "../../../packages/design-system/src";\n' +
      '[data-fixture-secret] { color: transparent !important; position: relative; }\n' +
      '[data-fixture-secret]::after { content: attr(data-fixture-secret) " (masked by the fixture)"; position: absolute; inset: 0; color: var(--foreground); }\n',
  );
  // The settings page keys the Git tab by site (`git-${projectId}`); `showSite` switches it as leaving and coming back
  // does. `kept` says which of the given values the QueryClient holds, by label.
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { dehydrate, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GitWorkflow as After } from '@/components/settings/git-workflow';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { GitWorkflow as Before } from './before/git-workflow';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = createQueryClient();
const fixture = window as unknown as {
  invalidated: unknown[];
  showSite?: (site: string) => void;
  kept?: (values: Record<string, string>) => Record<string, string[]>;
};
fixture.invalidated = [];
const invalidate = client.invalidateQueries.bind(client);
client.invalidateQueries = ((filters, options) => {
  fixture.invalidated.push(filters?.queryKey ?? null);
  return invalidate(filters, options);
}) as typeof client.invalidateQueries;
const text = (value: unknown) =>
  JSON.stringify(value, (_key, item: unknown) => (item instanceof Error ? { ...item, message: item.message, stack: item.stack } : item));
fixture.kept = (values) => {
  const places = {
    mutations: text(client.getMutationCache().getAll().map((mutation) => mutation.state)),
    queries: text(client.getQueryCache().getAll().map((query) => query.state)),
    dehydrateAll: text(dehydrate(client, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true })),
    dehydrateDefault: text(dehydrate(client)),
  };
  return Object.fromEntries(Object.entries(values).map(([name, value]) => [name, Object.entries(places).filter(([, held]) => held.includes(value)).map(([place]) => place)]));
};
// Labels the one-time secret for the fixture's mask (the app renders it in the "copy secret" alert).
const secrets = JSON.parse(params.get('secrets') ?? '[]') as string[];
new MutationObserver(() => {
  for (const node of document.querySelectorAll('[data-slot="alert-description"]')) {
    const index = secrets.indexOf(node.textContent ?? '');
    if (index !== -1 && !node.hasAttribute('data-fixture-secret')) node.setAttribute('data-fixture-secret', '<SECRET_' + (index + 1) + '>');
  }
}).observe(document.body, { subtree: true, childList: true, characterData: true });
const Workflow = params.get('version') === 'before' ? Before : After;
function Page() {
  const [site, setSite] = useState('site-a');
  useEffect(() => {
    fixture.showSite = setSite;
  }, []);
  return <Workflow key={'git-' + site} projectId={site} />;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
        <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Page /></main>
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
  const status = (site) => ({
    id: `connection-${site}`,
    repository: REPOSITORY,
    baseBranch: 'main',
    headBranch: 'nibleaf/docs',
    contentPath: 'docs',
    importBranchId: null,
    importLanguageId: null,
    credentialConfigured: true,
    webhookConfigured: true,
    lastSyncStatus: 'IDLE',
    lastSyncError: null,
    lastSyncedAt: null,
    operations: [],
    pullRequests: [],
    files: [],
  });

  /**
   * Opens the fixture on site A, not connected. A status GET answers the site's connection once a Connect stored it,
   * else null. An authorization POST answers the fictional account. A connection PUT is recorded with its token as a
   * label, held while `server.hold` (until `server.release()`), refused with 400 while `server.refuse` (once; echoing
   * the token in its message when `server.echo`), else stored: the site is connected and the answer carries the next
   * one-time secret. Any other API call fails the run.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const consoleLines = [];
    const requests = [];
    const held = [];
    const connected = new Set();
    let secrets = 0;
    const server = { hold: false, refuse: false, echo: false, release: () => held.shift()?.(), held: () => held.length };
    const json = (route, body, statusCode = 200) =>
      route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(body) });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (line) => consoleLines.push(line.text()));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}`;
      const site = /^\/api\/app\/projects\/(site-[ab])\/git/.exec(url.pathname)?.[1];
      if (site && call === `GET /api/app/projects/${site}/git`) {
        requests.push({ call });
        return json(route, { data: connected.has(site) ? status(site) : null });
      }
      if (site && call === `POST /api/app/projects/${site}/git/authorize`) {
        requests.push({ call, body: { token: label(JSON.parse(request.postData() ?? '{}').token) } });
        return json(route, { data: ACCOUNT });
      }
      if (site && call === `PUT /api/app/projects/${site}/git/connection`) {
        const body = JSON.parse(request.postData() ?? 'null');
        requests.push({ call, body: { ...body, ...('token' in body ? { token: label(body.token) } : {}) } });
        if (server.hold) await new Promise((done) => held.push(done));
        if (server.refuse) {
          server.refuse = false;
          const message = server.echo ? `Bad credentials: ${body.token}` : 'Base branch trunk was not found.';
          return json(route, { error: { code: 'BAD_REQUEST', message } }, 400);
        }
        connected.add(site);
        const webhookSecret = SECRETS[secrets++] ?? null;
        return json(route, { data: { connection: status(site), webhookSecret } });
      }
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}&secrets=${encodeURIComponent(JSON.stringify(SECRETS))}`);
    await page.locator('#git2-token').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, consoleLines, requests, server };
  }

  const settle = (page, ms = 300) => page.waitForTimeout(ms);
  const arrived = async (page, server, count = 1) => {
    for (let tries = 0; server.held() < count && tries < 100; tries += 1) await page.waitForTimeout(50);
    assert.ok(server.held() >= count);
  };
  const button = (page, locale, id) => page.locator('button', { hasText: msg(locale, id) }).first();
  const connectButton = (page, locale) => button(page, locale, 'settings.git.workflow.connect');
  /** Steps 1 and 2 as a person does them, up to the review: check the token, then fill the repository. */
  const toReview = async (page, locale) => {
    await page.locator('#git2-token').fill(TOKEN);
    await button(page, locale, 'settings.git.workflow.authorize').click();
    await page.locator('#git2-repo').waitFor();
    await page.locator('#git2-repo').fill(REPOSITORY);
    await button(page, locale, 'settings.git.workflow.review').click();
    await settle(page);
  };
  const puts = (requests) => requests.filter(({ call }) => call.startsWith('PUT'));
  /** What a reviewer should see: the step, Connect, the connected screen, the secret (as a label), toasts, refreshed keys. */
  const readback = (page, locale) =>
    page.evaluate(
      async ({ secrets, connect, copySecret }) => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const steps = [...document.querySelectorAll('ol > li')];
        const index = steps.findIndex((item) => item.getAttribute('aria-current') === 'step');
        const field = document.querySelector('#git2-token');
        // Connect, while the wizard shows.
        const button = steps.length ? [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(connect)) : undefined;
        const title = [...document.querySelectorAll('[data-slot="alert-title"]')].find((item) => item.textContent === copySecret);
        const secret = title?.parentElement?.querySelector('[data-slot="alert-description"]') ?? null;
        const shown = secret?.textContent ?? null;
        return {
          dir: document.documentElement.dir,
          step: index === -1 ? null : index + 1,
          tokenMasked: field ? getComputedStyle(field).getPropertyValue('-webkit-text-security') === 'disc' : null,
          connect: button ? { busy: button.getAttribute('aria-busy') === 'true', disabled: button.disabled } : null,
          connected: document.querySelector('main nav') !== null,
          secret: shown === null ? null : secrets.includes(shown) ? `<SECRET_${secrets.indexOf(shown) + 1}>` : '<OTHER>',
          secretMasked: secret ? getComputedStyle(secret).color === 'rgba(0, 0, 0, 0)' : null,
          toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
          invalidated: window.invalidated,
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      },
      { secrets: SECRETS, connect: msg(locale, 'settings.git.workflow.connect'), copySecret: msg(locale, 'settings.git.workflow.copySecret') },
    );
  /** Which of the token and the secrets the page's QueryClient holds, and whether the console printed any, by label. */
  const retention = async (page, consoleLines) => {
    const values = { '<TOKEN_A>': TOKEN, '<SECRET_1>': SECRETS[0], '<SECRET_2>': SECRETS[1] };
    const cache = await page.evaluate((given) => window.kept(given), values);
    const printed = Object.entries(values)
      .filter(([, value]) => consoleLines.some((line) => line.includes(value)))
      .map(([name]) => name);
    return { cache: Object.fromEntries(Object.entries(cache).filter(([, places]) => places.length)), console: printed };
  };
  const showConnectionPanel = async (page, locale) => {
    const nav = page.locator('nav button', { hasText: msg(locale, 'settings.git.workflow.nav.connection') });
    if (await nav.count()) await nav.click();
    await settle(page);
  };

  /** Each state, run on both versions: what the person did before the screenshot. */
  const STATES = {
    review: { label: 'Step 3, review (token A checked); Connect ready', run: async () => undefined },
    held: {
      label: 'Connect pressed, request held',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await connectButton(page, locale).click();
        await arrived(page, server);
        await settle(page);
      },
    },
    refused: {
      label: 'Connect refused (400): one toast, the review kept, Connect ready',
      run: async ({ page, server, locale }) => {
        server.refuse = true;
        await connectButton(page, locale).click();
        await settle(page, 700);
      },
    },
    connected: {
      label: 'Connect stored and read back: the connected screen, its Connection panel showing the one-time secret (masked)',
      run: async ({ page, locale }) => {
        await connectButton(page, locale).click();
        await settle(page, 900);
        await showConnectionPanel(page, locale);
      },
    },
    echo: {
      label: 'A refusal (400) whose message echoes the token: the toast never shows it; where it stays is in evidence.json',
      run: async ({ page, server, locale }) => {
        server.refuse = true;
        server.echo = true;
        await connectButton(page, locale).click();
        await settle(page, 700);
      },
    },
    returned: {
      label: 'Ordinary: Connect held, the Git tab left for site B and reopened for A, the wizard redone to its review',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await connectButton(page, locale).click();
        await arrived(page, server);
        await page.evaluate(() => window.showSite('site-b'));
        await settle(page);
        await page.evaluate(() => window.showSite('site-a'));
        await page.locator('#git2-token').waitFor();
        await toReview(page, locale);
        server.readyOnReturn = (await readback(page, locale)).connect;
        // A press there: main sends a second first-connect for the site; here nothing is sent.
        await connectButton(page, locale)
          .click({ timeout: 1500 })
          .catch(() => undefined);
        await settle(page, 500);
      },
    },
    sameTick: {
      label: 'Synthetic (one task): Connect pressed three times, request held',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await connectButton(page, locale).evaluate((element) => {
          for (let press = 0; press < 3; press += 1) element.click();
        });
        await arrived(page, server);
        await settle(page);
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
            const { page, errors, consoleLines, requests, server } = await open(context, { locale, version });
            await toReview(page, locale);
            await run({ page, server, locale });
            const read = await readback(page, locale);
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            assert.deepEqual(errors, []);
            if (read.tokenMasked !== null) assert.equal(read.tokenMasked, true, 'the token field is masked in every screenshot');
            if (read.secret !== null) assert.equal(read.secretMasked, true, 'the secret is masked in every screenshot');
            await page.mouse.move(0, 0);
            shots[`${locale}-${state}-${version}`] = await page.locator('main').screenshot({ animations: 'disabled' });
            seen[`${locale}-${state}-${version}`] = {
              ...read,
              ...(server.readyOnReturn !== undefined ? { connectOnReturn: server.readyOnReturn } : {}),
              retained: await retention(page, consoleLines),
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
        const sent = {
          call: 'PUT /api/app/projects/site-a/git/connection',
          body: { repository: REPOSITORY, baseBranch: 'main', headBranch: 'nibleaf/docs', contentPath: 'docs', token: '<TOKEN_A>' },
        };
        const toastsOf = (state, version) => at(state, version).toasts;
        for (const version of ['before', 'after']) {
          // The same body on both, the same refusal and the same connected screen with the secret.
          assert.deepEqual([at('review', version).step, at('review', version).connect], [3, { busy: false, disabled: false }]);
          assert.deepEqual(puts(at('held', version).requests), [sent]);
          assert.equal(at('held', version).connect.busy, true);
          assert.deepEqual([at('refused', version).step, at('refused', version).connect.busy], [3, false]);
          assert.deepEqual(toastsOf('refused', version), [msg(locale, 'settings.git.workflow.connectError')]);
          assert.deepEqual(at('refused', version).invalidated, [A]);
          assert.deepEqual([at('connected', version).connected, at('connected', version).secret], [true, '<SECRET_1>']);
          assert.deepEqual(toastsOf('connected', version), [msg(locale, 'settings.git.workflow.connected')]);
          assert.deepEqual(at('connected', version).invalidated, [A, A]);
          assert.deepEqual(toastsOf('echo', version), [msg(locale, 'settings.git.workflow.connectError')]);
        }
        // Main keeps the token and the secret in its MutationCache (and so any dehydration of every mutation), and
        // prints the echoed refusal, token included, to the console. Here the QueryClient and the console hold neither.
        assert.deepEqual(at('connected', 'before').retained.cache['<TOKEN_A>'], ['mutations', 'dehydrateAll']);
        assert.deepEqual(at('connected', 'before').retained.cache['<SECRET_1>'], ['mutations', 'dehydrateAll']);
        assert.deepEqual(at('echo', 'before').retained.console, ['<TOKEN_A>']);
        for (const state of Object.keys(STATES)) assert.deepEqual(at(state, 'after').retained, { cache: {}, console: [] });
        // Main: three PUTs for one press of three clicks in one task; here one, busy.
        assert.equal(puts(at('sameTick', 'before').requests).length, 3);
        assert.deepEqual(puts(at('sameTick', 'after').requests), [sent]);
        assert.equal(at('sameTick', 'after').connect.busy, true);
        // Main: back on the site while its Connect is held, Connect is ready and sends a second first connect; here it
        // is busy and sends nothing.
        assert.deepEqual(at('returned', 'before').connectOnReturn, { busy: false, disabled: false });
        assert.equal(puts(at('returned', 'before').requests).length, 2);
        assert.deepEqual(at('returned', 'after').connectOnReturn, { busy: true, disabled: true });
        assert.deepEqual(puts(at('returned', 'after').requests), [sent]);
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(Math.min(width, 1024) * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const caption = (key) => {
        const { requests, toasts, invalidated, step, connect, connected, secret, retained, connectOnReturn } = seen[key];
        const keys = invalidated.map((item) => JSON.stringify(item)).join(' ') || 'none';
        const where = connected ? 'connected screen' : step === null ? 'wizard hidden' : `step ${step}`;
        const kept = Object.entries(retained.cache)
          .map(([name, places]) => `${name} in ${places.join('+')}`)
          .join(', ');
        return `${where} · PUTs ${puts(requests).length} · Connect ${connect ? (connect.busy ? 'busy' : connect.disabled ? 'disabled' : 'ready') : 'n/a'}${connectOnReturn ? ` (on return: ${connectOnReturn.busy ? 'busy' : 'ready'})` : ''} · secret ${secret ?? 'none'} · refreshed ${keys} · toasts ${toasts.length} · QueryClient keeps ${kept || 'nothing'} · console ${retained.console.join(', ') || 'clean'}`;
      };
      const panel = (key) =>
        `<img src="data:image/png;base64,${shots[key].toString('base64')}" width="${shown}" style="display:block;border:1px solid #bbb"><div style="font-size:11px;margin-top:2px;max-width:${shown}px">${caption(key).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</div>`;
      const rows = (locale) =>
        Object.entries(STATES)
          .map(
            ([state, { label: text }]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${text}</b></div><div>${panel(`${locale}-${state}-before`)}</div><div>${panel(`${locale}-${state}-after`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Connect GitHub → Connect · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional site, placeholder token and secrets (masked; shown here as labels), every request intercepted, nothing sent to GitHub</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (main ${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', states: seen });
    }

    // This branch, EN at 1440: check → review → Connect held → refused → Connect again held → stored and read back →
    // the connected screen → its Connection panel with the one-time secret (masked).
    {
      const locale = 'en';
      const width = 1440;
      const file = `flow-after-${locale}-${width}.webm`;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
        recordVideo: { dir: harness, size: { width, height: 900 } },
      });
      const { page, errors, consoleLines, requests, server } = await open(context, { locale, version: 'after' });
      const pause = (ms = 700) => page.waitForTimeout(ms);
      const steps = [];
      const note = async (moment) => {
        steps.push({
          moment,
          ...(await readback(page, locale)),
          retained: await retention(page, consoleLines),
          requests: requests.map((item) => ({ ...item })),
        });
      };
      await pause();
      await toReview(page, locale);
      await pause();
      await note('token checked, on to the review');
      server.hold = true;
      server.refuse = true;
      await connectButton(page, locale).click();
      await arrived(page, server);
      await pause();
      await note('Connect pressed, held');
      server.release();
      await pause(1200);
      await note('refused: one toast, the review kept, Connect ready');
      await connectButton(page, locale).click();
      await arrived(page, server);
      await pause();
      await note('Connect again, held');
      server.hold = false;
      server.release();
      await pause(1200);
      await note('stored and read back: connected');
      await showConnectionPanel(page, locale);
      await pause(1500);
      await note('Connection panel: the one-time secret (masked)');
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, version: 'after', locale, width, theme: 'light', pageErrors: errors, steps });
      const step = (prefix) => steps.find(({ moment }) => moment.startsWith(prefix));
      assert.equal(step('Connect pressed').connect.busy, true);
      assert.deepEqual([step('refused').step, step('refused').connect.busy, step('refused').toasts.length], [3, false, 1]);
      assert.equal(step('Connect again').connect.busy, true);
      assert.equal(step('stored').connected, true);
      assert.deepEqual([step('Connection panel').secret, step('Connection panel').secretMasked], ['<SECRET_1>', true]);
      assert.equal(puts(step('Connection panel').requests).length, 2);
      for (const { retained } of steps) assert.deepEqual(retained, { cache: {}, console: [] });
    }

    assert.equal(attempted.length, 0);
    const evidence = {
      environment: `Component fixture: main's GitWorkflow, its features/site-git slice and useConnectGitWorkflow (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient (invalidations recorded) and the Git workflow status query; authorization and connection requests answered by interception (a fictional account; a stored connection with a fictional one-time secret, or a 400), optionally held; fictional sites; the placeholder token and secrets written as <TOKEN_A>/<SECRET_n> labels and masked on screen; not the signed-in dashboard, production, the server or GitHub`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      recordings,
    };
    const written = JSON.stringify(evidence);
    for (const value of [TOKEN, ...SECRETS]) assert.ok(!written.includes(value), 'no token or secret value in evidence.json');
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), evidence);
  });
  console.log(`${captures.length} before/after sheets and ${recordings.length} recording; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    // Windows may hold the recording open for a moment after the browser closes.
    await rm(harness, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
