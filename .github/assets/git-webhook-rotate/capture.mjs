// Isolated component fixture of Settings → Git → Connection → Webhook → Rotate webhook secret: main's GitWorkflow and
// its useRotateGitWorkflowWebhookSecret (before) and this branch's GitWorkflow and rotation command (after), with the
// real design system and confirmation dialog, EN/AR catalogs, the app's own QueryClient (wrapped to record which keys
// are invalidated) and the Git workflow status query, for fictional sites. Every API request is answered by
// interception on the fixture origin; a rotation POST can be held until the script answers it. Not the signed-in
// dashboard and not production. No server starts and nothing reaches GitHub or any provider: no real key or secret is
// rotated. The webhook secrets are fictional low-entropy placeholders, masked on screen by the fixture's own style,
// and evidence.json writes each as a label (`<SECRET_1>`), never the value.
//
// The before side is immutable: main's git-workflow.tsx and its whole features/site-git slice at BASE, and BASE's
// hooks/api/git-workflow.ts for useRotateGitWorkflowWebhookSecret (read with `git show`). Everything else it imports is
// checked to be unchanged since BASE, so neither side mixes in a module this branch changed.
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
/** A message by its id as the code names it (`settings.git.workflow.rotateSecret`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://git-webhook-rotate.fixture.test';
/** The main commit this branch starts from (#798), pinned; evidence.json records it as `base`. */
const BASE = '5e3fd880217bce138ec997c8c00195f33ab0d627';
/** Fictional placeholders, nothing like a real webhook secret. */
const SECRETS = ['test-secret-0001', 'test-secret-0002', 'test-secret-0003'];
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
// This branch removes useRotateGitWorkflowWebhookSecret from hooks/api/git-workflow.ts: the before side takes that
// file from BASE, and it is checked to have changed by nothing else.
const HOOKS = 'apps/app/src/hooks/api/git-workflow.ts';
const ROTATE_HOOK = [
  '',
  '',
  'export const useRotateGitWorkflowWebhookSecret = (projectId: string) =>',
  '  useGitWorkflowMutation(projectId, async (_: undefined) =>',
  "    mutateData(await api.app.projects[':projectId'].git['webhook-secret'].$post({ param: { projectId } }), 'Could not rotate the webhook secret.'),",
  '  );',
].join('\n');
const baseHooks = git('show', `${BASE}:${HOOKS}`);
assert.equal(git('diff', '--name-only', BASE, '--', ...SHARED, `:(exclude)${HOOKS}`), '', 'a module both sides share changed since BASE');
assert.ok(baseHooks.endsWith(ROTATE_HOOK), 'BASE ends with useRotateGitWorkflowWebhookSecret');
assert.equal(
  (await readFile(resolve(root, HOOKS), 'utf8')).replaceAll('\r\n', '\n').trim(),
  baseHooks.replace(ROTATE_HOOK, ''),
  'hooks/api/git-workflow.ts changed since BASE by more than the removal of useRotateGitWorkflowWebhookSecret',
);

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-webhook-rotate-capture-'));
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
    "export * from '@/hooks/api';\nexport { useRotateGitWorkflowWebhookSecret } from './git-workflow-hooks';\n",
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
  // does. `kept` says which of the given values the QueryClient holds, by label; `paused` counts the mutations the
  // default dehydration (what an offline persister keeps) would carry.
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
  paused?: () => number;
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
fixture.paused = () => dehydrate(client).mutations.length;
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
   * Opens the fixture on site A, connected, at its Connection panel. A status GET answers the site's connection. A
   * rotation POST is recorded with its body (none is sent), held while `server.hold` (until `server.release()`),
   * refused with a 429 and `Retry-After: 30` while `server.refuse` (once), else answered with the next placeholder
   * secret. Any other API call fails the run.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const consoleLines = [];
    const requests = [];
    const held = [];
    let secrets = 0;
    const server = { hold: false, refuse: false, offline: false, release: () => held.shift()?.(), held: () => held.length };
    const json = (route, body, statusCode = 200, headers = {}) =>
      route.fulfill({ status: statusCode, contentType: 'application/json', headers, body: JSON.stringify(body) });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (line) => consoleLines.push(line.text()));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}`;
      const site = /^\/api\/app\/projects\/(site-[ab])\/git/.exec(url.pathname)?.[1];
      // Interception would answer even while the browser emulates offline; a real offline browser reaches nothing.
      if (server.offline && url.pathname.startsWith('/api/')) {
        if (request.method() === 'POST') requests.push({ call, body: request.postData() ?? null, offline: true });
        return route.abort('internetdisconnected');
      }
      if (site && call === `GET /api/app/projects/${site}/git`) {
        requests.push({ call });
        return json(route, { data: status(site) });
      }
      if (site && call === `POST /api/app/projects/${site}/git/webhook-secret`) {
        requests.push({ call, body: request.postData() ?? null });
        if (server.hold) await new Promise((done) => held.push(done));
        if (server.refuse) {
          server.refuse = false;
          return json(route, { error: { code: 'http:rate_limited', message: 'Too many requests.' } }, 429, { 'retry-after': '30' });
        }
        return json(route, { data: { webhookSecret: SECRETS[secrets++] ?? null } });
      }
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}&secrets=${encodeURIComponent(JSON.stringify(SECRETS))}`);
    await showConnectionPanel(page, locale);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, consoleLines, requests, server };
  }

  const settle = (page, ms = 300) => page.waitForTimeout(ms);
  const arrived = async (page, server, count = 1) => {
    for (let tries = 0; server.held() < count && tries < 100; tries += 1) await page.waitForTimeout(50);
    assert.ok(server.held() >= count);
  };
  const showConnectionPanel = async (page, locale) => {
    const nav = page.locator('main nav button', { hasText: msg(locale, 'settings.git.workflow.nav.connection') });
    await nav.waitFor({ timeout: 15_000 });
    await nav.click();
    await rotateButton(page, locale).waitFor();
    await settle(page);
  };
  const rotateButton = (page, locale) => page.locator('main button', { hasText: msg(locale, 'settings.git.workflow.rotateSecret') }).first();
  const dialog = (page) => page.locator('[role="dialog"], [role="alertdialog"]');
  /** Rotate pressed: the destructive confirmation opens. */
  const press = async (page, locale) => {
    await rotateButton(page, locale).click();
    await dialog(page).waitFor();
    await settle(page);
  };
  const confirmDialog = async (page, locale) => {
    await dialog(page)
      .locator('button', { hasText: msg(locale, 'settings.git.workflow.rotateSecret') })
      .click();
    await settle(page);
  };
  const cancelDialog = async (page) => {
    await dialog(page).locator('button').first().click();
    await settle(page);
  };
  const posts = (requests) => requests.filter(({ call }) => call.startsWith('POST'));
  /** What a reviewer should see: Rotate, the dialog, the secret (as a label), toasts, refreshed keys. */
  const readback = (page, locale) =>
    page.evaluate(
      async ({ secrets, rotate, copySecret }) => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const button = [...document.querySelectorAll('main button')].find((item) => item.textContent?.trim() === rotate);
        const title = [...document.querySelectorAll('[data-slot="alert-title"]')].find((item) => item.textContent === copySecret);
        const secret = title?.parentElement?.querySelector('[data-slot="alert-description"]') ?? null;
        const shown = secret?.textContent ?? null;
        return {
          dir: document.documentElement.dir,
          rotate: button ? { busy: button.getAttribute('aria-busy') === 'true', disabled: button.disabled } : null,
          dialog: document.querySelector('[role="dialog"], [role="alertdialog"]') !== null,
          secret: shown === null ? null : secrets.includes(shown) ? `<SECRET_${secrets.indexOf(shown) + 1}>` : '<OTHER>',
          secretMasked: secret ? getComputedStyle(secret).color === 'rgba(0, 0, 0, 0)' : null,
          toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
          invalidated: window.invalidated,
          pausedInDefaultDehydrate: window.paused(),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      },
      { secrets: SECRETS, rotate: msg(locale, 'settings.git.workflow.rotateSecret'), copySecret: msg(locale, 'settings.git.workflow.copySecret') },
    );
  /** Which of the secrets the page's QueryClient holds, and whether the console printed any, by label. */
  const retention = async (page, consoleLines) => {
    const values = Object.fromEntries(SECRETS.map((value, index) => [`<SECRET_${index + 1}>`, value]));
    const cache = await page.evaluate((given) => window.kept(given), values);
    const printed = Object.entries(values)
      .filter(([, value]) => consoleLines.some((line) => line.includes(value)))
      .map(([name]) => name);
    return { cache: Object.fromEntries(Object.entries(cache).filter(([, places]) => places.length)), console: printed };
  };

  /** Each state, run on both versions: what the person did before the screenshot. */
  const STATES = {
    confirm: {
      label: 'Rotate pressed: the destructive confirmation',
      run: async ({ page, locale }) => press(page, locale),
    },
    held: {
      label: 'Confirmed, request held: Rotate busy',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await press(page, locale);
        await confirmDialog(page, locale);
        await arrived(page, server);
      },
    },
    rotated: {
      label: 'Stored and read back: the one-time secret in the panel (masked)',
      run: async ({ page, locale }) => {
        await press(page, locale);
        await confirmDialog(page, locale);
        await settle(page, 700);
      },
    },
    refused: {
      label: 'Refused (429, Retry-After 30): one rate-limited toast, Rotate ready',
      run: async ({ page, server, locale }) => {
        server.refuse = true;
        await press(page, locale);
        await confirmDialog(page, locale);
        await settle(page, 700);
      },
    },
    returned: {
      label: 'Ordinary: rotation held, the Git tab left for site B and reopened for A, Rotate pressed and confirmed again',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await press(page, locale);
        await confirmDialog(page, locale);
        await arrived(page, server);
        await page.evaluate(() => window.showSite('site-b'));
        await settle(page);
        await page.evaluate(() => window.showSite('site-a'));
        await showConnectionPanel(page, locale);
        server.rotateOnReturn = (await readback(page, locale)).rotate;
        // A press there: main sends a second rotation for the site; here Rotate is busy and nothing more is sent.
        const ready = !server.rotateOnReturn.disabled;
        if (ready) {
          await press(page, locale);
          await confirmDialog(page, locale);
        }
        await settle(page, 500);
      },
    },
    leftWhileAsking: {
      label: 'Ordinary: the confirmation open, the Git tab left for site B, then the confirmation accepted',
      run: async ({ page, locale }) => {
        await press(page, locale);
        await page.evaluate(() => window.showSite('site-b'));
        await settle(page);
        await confirmDialog(page, locale);
        await settle(page, 500);
      },
    },
    offline: {
      label: 'Offline: Rotate confirmed, then the Git tab left for site B and the connection back',
      run: async ({ page, server, locale, context }) => {
        server.offline = true;
        await context.setOffline(true);
        await settle(page);
        await press(page, locale);
        await confirmDialog(page, locale);
        await settle(page, 500);
        await page.evaluate(() => window.showSite('site-b'));
        await settle(page);
        server.offline = false;
        await context.setOffline(false);
        await settle(page, 900);
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
            const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
            const { page, errors, consoleLines, requests, server } = await open(context, { locale, version });
            await run({ page, server, locale, context });
            const read = await readback(page, locale);
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            // The offline state's dropped request is the browser's own console line; no page error anywhere.
            assert.deepEqual(errors, []);
            if (read.secret !== null) assert.equal(read.secretMasked, true, 'the secret is masked in every screenshot');
            await page.mouse.move(0, 0);
            // The viewport, so the confirmation (a portal outside the page's main) shows too.
            shots[`${locale}-${state}-${version}`] = await page.screenshot({ animations: 'disabled' });
            seen[`${locale}-${state}-${version}`] = {
              ...read,
              ...(server.rotateOnReturn !== undefined ? { rotateOnReturn: server.rotateOnReturn } : {}),
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
        const sent = { call: 'POST /api/app/projects/site-a/git/webhook-secret', body: null };
        for (const version of ['before', 'after']) {
          // The same confirmation, the same request (no body), the same busy, secret, refusal and readback on both.
          assert.deepEqual([at('confirm', version).dialog, posts(at('confirm', version).requests)], [true, []]);
          assert.deepEqual(posts(at('held', version).requests), [sent]);
          assert.equal(at('held', version).rotate.busy, true);
          assert.deepEqual([at('rotated', version).secret, at('rotated', version).rotate.busy], ['<SECRET_1>', false]);
          assert.deepEqual(at('rotated', version).invalidated, [A]);
          assert.deepEqual(at('rotated', version).toasts, []);
          assert.deepEqual(at('refused', version).toasts, [msg(locale, 'error.rateLimited')]);
          assert.deepEqual([at('refused', version).rotate.busy, at('refused', version).secret], [false, null]);
        }
        // Main keeps the secret in its MutationCache (and so any dehydration of every mutation). Here the QueryClient
        // and the console hold none.
        assert.deepEqual(at('rotated', 'before').retained.cache['<SECRET_1>'], ['mutations', 'dehydrateAll']);
        for (const state of Object.keys(STATES)) assert.deepEqual(at(state, 'after').retained, { cache: {}, console: [] });
        // Main: back on the site while its rotation is held, Rotate is ready and sends a second rotation; here it is
        // busy and sends nothing.
        assert.deepEqual(at('returned', 'before').rotateOnReturn, { busy: false, disabled: false });
        assert.equal(posts(at('returned', 'before').requests).length, 2);
        assert.deepEqual(at('returned', 'after').rotateOnReturn, { busy: true, disabled: true });
        assert.deepEqual(posts(at('returned', 'after').requests), [sent]);
        // Main: a confirmation accepted after leaving still rotates site A; here nothing is sent.
        assert.deepEqual(posts(at('leftWhileAsking', 'before').requests), [sent]);
        assert.deepEqual(posts(at('leftWhileAsking', 'after').requests), []);
        // Main: offline, the press is paused (kept by the default dehydration) and sent on reconnect, after the person
        // left the site, so nobody sees its secret. Here it is tried at once and fails offline (reaching nothing) with
        // the network toast, and the reconnect sends nothing.
        assert.deepEqual(posts(at('offline', 'before').requests), [sent]);
        assert.deepEqual(posts(at('offline', 'after').requests), [{ ...sent, offline: true }]);
        assert.deepEqual(at('offline', 'after').toasts, [msg(locale, 'error.network')]);
        assert.equal(at('offline', 'after').pausedInDefaultDehydrate, 0);
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(width * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const caption = (key) => {
        const { requests, toasts, invalidated, rotate, dialog: asking, secret, retained, rotateOnReturn, pausedInDefaultDehydrate } = seen[key];
        const keys = invalidated.map((item) => JSON.stringify(item)).join(' ') || 'none';
        const kept = Object.entries(retained.cache)
          .map(([name, places]) => `${name} in ${places.join('+')}`)
          .join(', ');
        const sites = posts(requests)
          .map(({ call, offline }) => `${call.split('/')[4]}${offline ? ' offline, failed' : ''}`)
          .join(', ');
        return `POSTs ${posts(requests).length}${sites ? ` (${sites})` : ''} · Rotate ${rotate ? (rotate.busy ? 'busy' : rotate.disabled ? 'disabled' : 'ready') : 'n/a'}${rotateOnReturn ? ` (on return: ${rotateOnReturn.busy ? 'busy' : 'ready'})` : ''} · dialog ${asking ? 'open' : 'closed'} · secret ${secret ?? 'none'} · refreshed ${keys} · toasts ${toasts.length} · paused ${pausedInDefaultDehydrate} · QueryClient keeps ${kept || 'nothing'} · console ${retained.console.join(', ') || 'clean'}`;
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
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Connection → Rotate webhook secret · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional sites, placeholder secrets (masked; shown here as labels), every request intercepted, no real key rotated</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (main ${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', states: seen });
    }

    // This branch, EN at 1440: Rotate → Cancel → Rotate → confirm, held → refused (429) → Rotate → confirm, held →
    // stored and read back → the one-time secret (masked).
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
      await note('Connection panel, Rotate ready');
      await press(page, locale);
      await pause();
      await note('Rotate pressed: the confirmation');
      await cancelDialog(page);
      await pause();
      await note('cancelled: nothing sent');
      server.hold = true;
      server.refuse = true;
      await press(page, locale);
      await pause(400);
      await confirmDialog(page, locale);
      await arrived(page, server);
      await pause();
      await note('confirmed, held: Rotate busy');
      server.release();
      await pause(1200);
      await note('refused (429): one toast, Rotate ready');
      await press(page, locale);
      await pause(400);
      await confirmDialog(page, locale);
      await arrived(page, server);
      await pause();
      await note('confirmed again, held');
      server.hold = false;
      server.release();
      await pause(1500);
      await note('stored and read back: the one-time secret (masked)');
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, version: 'after', locale, width, theme: 'light', pageErrors: errors, steps });
      const step = (prefix) => steps.find(({ moment }) => moment.startsWith(prefix));
      assert.equal(step('Rotate pressed').dialog, true);
      assert.equal(posts(step('cancelled').requests).length, 0);
      assert.equal(step('confirmed, held').rotate.busy, true);
      assert.deepEqual([step('refused').rotate.busy, step('refused').toasts.length], [false, 1]);
      assert.equal(step('confirmed again').rotate.busy, true);
      assert.deepEqual([step('stored').secret, step('stored').secretMasked, step('stored').rotate.busy], ['<SECRET_1>', true, false]);
      assert.equal(posts(step('stored').requests).length, 2);
      for (const { retained } of steps) assert.deepEqual(retained, { cache: {}, console: [] });
    }

    assert.equal(attempted.length, 0);
    const evidence = {
      environment: `Component fixture: main's GitWorkflow, its features/site-git slice and useRotateGitWorkflowWebhookSecret (${BASE}) and this branch's, with the real design system and confirmation dialog, EN/AR catalogs, the app's QueryClient (invalidations recorded) and the Git workflow status query; rotation requests answered by interception (a fictional one-time secret, or a 429), optionally held; offline by the browser's own emulation; fictional sites; the placeholder secrets written as <SECRET_n> labels and masked on screen; not the signed-in dashboard, production, the server or GitHub; no real key or secret rotated`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      recordings,
    };
    const written = JSON.stringify(evidence);
    for (const value of SECRETS) assert.ok(!written.includes(value), 'no secret value in evidence.json');
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
