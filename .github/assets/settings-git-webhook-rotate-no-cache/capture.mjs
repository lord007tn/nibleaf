// Isolated component fixture of Settings → Git → (legacy import) Deploy on push → Rotate webhook secret: main's GitTab
// and its useRotateGitWebhookSecret at the pinned base (before) and this branch's GitTab and rotation command (after),
// with the real design system, EN/AR catalogs, the app's QueryClient and the settings query, for fictional sites.
// Every API request is answered by interception on the fixture origin; a rotation POST can be held until the script
// answers it. Not the signed-in dashboard and not production. No server starts and no secret is rotated anywhere.
//
// The "before" side is built from the pinned base: its GitTab, the `features/site-git` slice it imports and its
// rotation hook are read with `git show`, so a later refactor of today's files cannot change it. Only the shared app
// modules (`@/hooks/api`, the design system, the query client) are today's.
//
// Sites and secrets are low-entropy placeholders. Screenshots and evidence.json show them only as labels
// (`<id#n>`, `<credential#n>`); this is asserted.
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
/** A message by its id as the code names it (`settings.git.webhook.rotate`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://settings-git-webhook-rotate.fixture.test';
/** The main commit this branch starts from (#827); evidence.json records it as `base`. */
const BASE = '84d80dc993663e8c84557dc03f1a5f2d5abb02cf';
const SITE_A = '00000000-0000-4000-8000-000000000001';
const SITE_B = '00000000-0000-4000-8000-000000000002';
const SECRETS = ['test-secret-0001', 'test-secret-0002', 'test-secret-0003', 'test-secret-0004'];
/** Every placeholder as the label captures show instead. */
const LABELS = [[SITE_A, '<id#1>'], [SITE_B, '<id#2>'], ...SECRETS.map((secret, index) => [secret, `<credential#${index + 1}>`])];
const label = (text) => LABELS.reduce((out, [value, name]) => out.replaceAll(value, name), String(text));
/** Which placeholder secrets `text` holds, as labels. */
const credentialsIn = (text) => LABELS.filter(([value, name]) => name.startsWith('<credential') && text.includes(value)).map(([, name]) => name);

let harness;
try {
  harness = await mkdtemp(resolve(app, '.settings-rotate-capture-'));
  const slice = git('ls-tree', '-r', '--name-only', BASE, 'apps/app/src/features/site-git')
    .split('\n')
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
  for (const file of slice) {
    const target = resolve(harness, 'before/site-git', file.replace('apps/app/src/features/site-git/', ''));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, git('show', `${BASE}:${file}`));
  }
  // Main's rotation hook as it is on the base (this branch removes it); every other hook is today's.
  const mainRotate =
    /\/\*\* Generate or rotate the push-to-deploy webhook secret[\s\S]*?\nexport const useRotateGitWebhookSecret = [\s\S]*?\n};\n/.exec(
      git('show', `${BASE}:apps/app/src/hooks/api/mutations.ts`),
    )?.[0];
  assert.ok(mainRotate, "main's useRotateGitWebhookSecret");
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    `export * from '@/hooks/api';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
${mainRotate}`,
  );
  await writeFile(
    resolve(harness, 'before/git-tab.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/git-tab.tsx`)
      .replaceAll("from '@/features/site-git/", "from './site-git/")
      .replace("from '@/hooks/api'", "from './hooks'")
      .replace("from './git-workflow'", "from '@/components/settings/git-workflow'")
      .replace("from './section'", "from '@/components/settings/section'"),
  );
  // The per-site connection above the legacy import renders as nothing on both sides.
  await writeFile(resolve(harness, 'git-workflow-stub.tsx'), 'export const GitWorkflow = () => null;\n');
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
import { dehydrate, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GitTab as After } from '@/components/settings/git-tab';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { GitTab as Before } from './before/git-tab';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = createQueryClient();
const Tab = params.get('version') === 'before' ? Before : After;
const fixture = window as unknown as Record<string, unknown>;
/** What the QueryClient's mutations keep, as text (state with the error's own fields, options, an all-mutation dehydration). */
fixture.retained = () => {
  const mutations = client.getMutationCache().getAll();
  const states = mutations.map((mutation) => {
    const error = mutation.state.error as (Error & Record<string, unknown>) | null;
    return { ...mutation.state, error: error && { ...error, message: error.message, stack: error.stack }, options: mutation.options };
  });
  const settings = client.getQueryCache().findAll({ queryKey: ['workspace', 'settings'] }).map((query) => query.state.data);
  return {
    mutations: mutations.length,
    pausedInDefaultDehydrate: dehydrate(client).mutations.length,
    mutationText: JSON.stringify(states) + JSON.stringify(dehydrate(client, { shouldDehydrateMutation: () => true }).mutations),
    settingsText: JSON.stringify(settings),
  };
};
function Page() {
  const [view, setView] = useState({ site: '${SITE_A}', away: false });
  fixture.go = setView;
  // The settings page keys the Git tab by site; "away" is another dashboard page (the provider stays).
  return view.away ? <p>Another page</p> : <Tab key={'git-' + view.site} projectId={view.site} />;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
        <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Page /></main>
      </DirectionProvider>
      <Toaster theme="light" />
    </ConfirmProvider>
  </QueryClientProvider>,
);
`,
  );
  const { build } = await fromApp('vite');
  const stub = resolve(harness, 'git-workflow-stub.tsx');
  await build({
    configFile: false,
    root: harness,
    logLevel: 'error',
    resolve: { alias: [{ find: /^@\//, replacement: `${resolve(app, 'src')}/` }] },
    plugins: [
      // Without TanStack Start's plugin, the isomorphic API origin keeps its server branch; the browser takes the client one.
      {
        name: 'client-api-origin',
        enforce: 'pre',
        resolveId: (source, importer) =>
          source === './api-origin' && importer?.replaceAll('\\', '/').endsWith('/src/services/api.ts') ? '\0client-api-origin' : undefined,
        load: (id) => (id === '\0client-api-origin' ? 'export const apiOrigin = () => window.location.origin;' : undefined),
      },
      {
        name: 'git-workflow-stub',
        enforce: 'pre',
        resolveId: (source, importer) =>
          /git-workflow$/.test(source) && /\/git-tab\.tsx$/.test(importer?.replaceAll('\\', '/') ?? '') ? stub : undefined,
      },
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };

  /**
   * Opens the fixture. The settings GET answers an admin with the stored secret (main's contract). A rotation POST is
   * held until `answer` releases it: stored and answered with the next secret, or refused. Branches, languages,
   * deployments and the per-site connection get fixed answers; any other API call fails the run.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const held = [];
    const server = { stored: { [SITE_A]: SECRETS[0], [SITE_B]: SECRETS[0] }, next: 1 };
    const json = (route, body, status = 200, headers = {}) =>
      route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}${url.search}`;
      const site = /^\/api\/app\/projects\/([^/]+)\//.exec(url.pathname)?.[1];
      if (site && call === `GET /api/app/projects/${site}/settings`) {
        requests.push({ call });
        const git = { connected: true, provider: 'gitlab', repo: 'acme-fixture/handbook', branch: 'main', path: 'docs', autoPublish: false };
        return json(route, { data: { plan: 'free', notifications: {}, integrations: {}, git: { ...git, webhookSecret: server.stored[site] } } });
      }
      if (site && call === `POST /api/app/projects/${site}/settings/git/webhook-secret`) {
        requests.push({ call, body: request.postData() });
        return new Promise((done) => held.push({ site, route, done }));
      }
      if (site && call === `GET /api/app/projects/${site}/git`) return json(route, { data: null });
      if (site && url.pathname.startsWith(`/api/app/projects/${site}/`) && request.method() === 'GET') return json(route, { data: [] });
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    /** Releases held rotation `index`: stored and answered with the next secret, or refused with an echo of one. */
    const answer = async (index, outcome = 'stored') => {
      const entry = held[index];
      assert.ok(entry, `no held rotation #${index}`);
      if (outcome === 'stored') {
        const secret = SECRETS[server.next++];
        server.stored[entry.site] = secret;
        await json(entry.route, { data: { webhookSecret: secret } });
      } else {
        const echo = `echo ${SECRETS[3]}`;
        await json(entry.route, { error: { code: echo, message: echo, details: { reason: echo } } }, 403, { 'retry-after': echo });
      }
      entry.done();
    };
    // Every frame shows labels in place of the placeholders (the fields are read-only; React may write them back).
    await page.addInitScript((labels) => {
      const relabel = () => {
        for (const input of document.querySelectorAll('input')) {
          const next = labels.reduce((out, [value, name]) => out.replaceAll(value, name), input.value);
          if (next !== input.value) input.value = next;
        }
        requestAnimationFrame(relabel);
      };
      requestAnimationFrame(relabel);
    }, LABELS);
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('#git-webhook-url').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, held, answer };
  }

  const settle = (page, ms = 700) => page.waitForTimeout(ms);
  const rotateButton = (page, locale) => page.getByRole('button', { name: msg(locale, 'settings.git.webhook.rotate'), exact: true });
  const go = (page, view) => page.evaluate((next) => window.go(next), view);
  /** What a reviewer should see, with every placeholder as its label; and what the QueryClient's mutations keep. */
  const readback = async (page, requests) => {
    const seen = await page.evaluate(() => {
      const input = document.querySelector('#git-webhook-secret');
      const button = [...document.querySelectorAll('button[aria-busy], button')].find((item) => item.querySelector('.lucide-refresh-cw'));
      return {
        dir: document.documentElement.dir,
        rotate: button ? { busy: button.getAttribute('aria-busy') === 'true' } : null,
        secret: input ? { value: input.value, revealed: !input.hasAttribute('data-masked') } : null,
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
        overflow: document.documentElement.scrollWidth > innerWidth,
        retained: window.retained(),
      };
    });
    const { mutationText, settingsText, ...retained } = seen.retained;
    return {
      ...seen,
      secret: seen.secret && { value: label(seen.secret.value), revealed: seen.secret.revealed },
      posts: requests.filter(({ call }) => call.startsWith('POST')).map(({ call, body }) => ({ call: label(call), body })),
      retained: {
        ...retained,
        // Which placeholders the mutations keep; "server text" when a refusal's echo is kept.
        byMutations: [...credentialsIn(mutationText), ...(mutationText.includes('echo') ? ['server text'] : [])],
        // Main's contract, unchanged here: the settings read answers an admin with the stored secret.
        bySettingsRead: credentialsIn(settingsText),
      },
    };
  };
  /** Shows labels in place of the placeholders, then shoots the Deploy on push step. */
  const shoot = async (page) => {
    await page.evaluate((labels) => {
      for (const input of document.querySelectorAll('input')) {
        input.value = labels.reduce((out, [value, name]) => out.replaceAll(value, name), input.value);
      }
    }, LABELS);
    const text = await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('input')].map((input) => input.value).join(' '));
    for (const [value] of LABELS) assert.ok(!text.includes(value), 'a placeholder is on screen unlabelled');
    await page.mouse.move(0, 0);
    const step = page.locator('li:has(#git-webhook-url)');
    await step.scrollIntoViewIfNeeded();
    return step.screenshot({ animations: 'disabled' });
  };

  /** Each state, run on both versions; `run` leaves the page as it is shot and returns extra readback. */
  const STATES = {
    held: {
      label: 'Rotate pressed, its request held',
      run: async ({ page, locale }) => {
        await rotateButton(page, locale).click();
      },
    },
    rotated: {
      label: 'Stored and read back: the new secret revealed',
      run: async ({ page, locale, answer }) => {
        await rotateButton(page, locale).click();
        await settle(page, 300);
        await answer(0);
      },
    },
    refused: {
      label: 'Refused (403, with server text echoing a placeholder)',
      run: async ({ page, locale, answer }) => {
        await rotateButton(page, locale).click();
        await settle(page, 300);
        await answer(0, 'refused');
      },
    },
    keyed: {
      label: 'Ordinary: rotation held, the tab left for <id#2> and reopened, Rotate pressed again if it can be',
      run: async ({ page, locale }) => {
        await rotateButton(page, locale).click();
        await settle(page, 300);
        await go(page, { site: SITE_B, away: false });
        await settle(page);
        await go(page, { site: SITE_A, away: false });
        await settle(page);
        // Busy is disabled: a person cannot press it, so neither does the script.
        const pressableOnReturn = await rotateButton(page, locale).isEnabled();
        if (pressableOnReturn) await rotateButton(page, locale).click();
        return { extra: { pressableOnReturn } };
      },
    },
    offline: {
      label: 'Ordinary: offline, Rotate pressed; then another page, then back online',
      run: async ({ page, locale, context, requests, answer, held }) => {
        await context.setOffline(true);
        await settle(page, 300);
        await rotateButton(page, locale).click();
        await settle(page);
        const atPress = requests.filter(({ call }) => call.startsWith('POST')).length;
        const shot = await shoot(page);
        const read = await readback(page, requests);
        await go(page, { site: SITE_A, away: true });
        await context.setOffline(false);
        await settle(page, 1500);
        if (held[0]) await answer(0);
        await settle(page);
        const after = await readback(page, requests);
        return {
          shot,
          read,
          extra: { postsAtPress: atPress, afterLeavingAndReconnecting: { posts: after.posts, toasts: after.toasts, retained: after.retained } },
        };
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
            const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light' });
            const opened = await open(context, { locale, version });
            const result = await run({ ...opened, context, locale });
            await settle(opened.page);
            const read = result?.read ?? (await readback(opened.page, opened.requests));
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            assert.deepEqual(opened.errors, []);
            shots[`${locale}-${state}-${version}`] = result?.shot ?? (await shoot(opened.page));
            seen[`${locale}-${state}-${version}`] = { ...read, ...(result?.extra ?? {}) };
            await context.close();
          }
        }
        // The behaviour each panel shows, asserted so a wrong capture fails the run.
        const at = (state, version) => seen[`${locale}-${state}-${version}`];
        const rotation = 'POST /api/app/projects/<id#1>/settings/git/webhook-secret';
        for (const version of ['before', 'after']) {
          assert.deepEqual(at('held', version).posts, [{ call: rotation, body: null }]);
          assert.equal(at('held', version).rotate.busy, true);
          assert.deepEqual(at('rotated', version).secret, { value: '<credential#2>', revealed: true });
          assert.deepEqual(at('rotated', version).toasts, [msg(locale, 'settings.git.webhook.rotated')]);
          assert.deepEqual(at('refused', version).toasts, [msg(locale, 'settings.git.webhook.rotateError')]);
          assert.deepEqual(at('rotated', version).retained.bySettingsRead, ['<credential#2>']);
        }
        assert.deepEqual(at('rotated', 'before').retained.byMutations, ['<credential#2>']);
        assert.deepEqual(at('refused', 'before').retained.byMutations, ['<credential#4>', 'server text']);
        assert.equal(at('keyed', 'before').pressableOnReturn, true);
        assert.equal(at('keyed', 'before').posts.length, 2);
        assert.equal(at('keyed', 'before').rotate.busy, true);
        assert.equal(at('offline', 'before').postsAtPress, 0);
        assert.equal(at('offline', 'before').retained.pausedInDefaultDehydrate, 1);
        assert.equal(at('offline', 'before').afterLeavingAndReconnecting.posts.length, 1);
        assert.deepEqual(at('offline', 'before').afterLeavingAndReconnecting.retained.byMutations, ['<credential#2>']);
        for (const state of Object.keys(STATES)) {
          assert.equal(at(state, 'after').retained.mutations, 0);
          assert.deepEqual(at(state, 'after').retained.byMutations, []);
        }
        assert.equal(at('keyed', 'after').pressableOnReturn, false);
        assert.equal(at('keyed', 'after').posts.length, 1);
        assert.equal(at('keyed', 'after').rotate.busy, true);
        assert.equal(at('offline', 'after').retained.pausedInDefaultDehydrate, 0);
        assert.equal(at('offline', 'after').afterLeavingAndReconnecting.posts.length, at('offline', 'after').postsAtPress);
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(Math.min(width, 768) * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const escapeHtml = (text) => String(text).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
      const caption = (key) => {
        const { posts, rotate, toasts, retained, afterLeavingAndReconnecting: later } = seen[key];
        const lines = [
          `POSTs: ${posts.length} · Rotate: ${rotate?.busy ? 'busy' : 'ready'} · toast: ${toasts.join(' / ') || '—'}`,
          `mutations: ${retained.mutations} (paused, default dehydrate: ${retained.pausedInDefaultDehydrate}) · kept by mutations: ${retained.byMutations.join(', ') || 'nothing'}`,
          ...(later
            ? [`after leaving + reconnecting: POSTs ${later.posts.length} · kept by mutations: ${later.retained.byMutations.join(', ') || 'nothing'}`]
            : []),
        ];
        return `<div style="margin-top:4px;font:12px ui-monospace,monospace">${lines.map(escapeHtml).join('<br>')}</div>`;
      };
      const panel = (key) =>
        `<img src="data:image/png;base64,${shots[key].toString('base64')}" width="${shown}" style="display:block;border:1px solid #bbb;background:#fff">${caption(key)}`;
      const rows = (locale) =>
        Object.entries(STATES)
          .map(
            ([state, { label: title }]) =>
              `<div style="grid-column:1/3;margin-top:12px"><b>${locale.toUpperCase()} · ${escapeHtml(title)}</b></div><div>${panel(`${locale}-${state}-before`)}</div><div>${panel(`${locale}-${state}-after`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Deploy on push → Rotate · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional sites and secrets, shown as labels · every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px;align-items:start"><div><b>Before (${BASE.slice(0, 8)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', states: seen });
    }

    // This branch, EN, 1440: Rotate held → refused → Rotate held, the tab left and reopened (still busy) → stored,
    // read back and revealed. Placeholders are relabelled on screen before each step is filmed.
    {
      const locale = 'en';
      const width = 1440;
      const file = `flow-after-${locale}-${width}.webm`;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
        recordVideo: { dir: harness, size: { width, height: 900 } },
      });
      const { page, errors, requests, answer } = await open(context, { locale, version: 'after' });
      const pause = (ms = 900) => page.waitForTimeout(ms);
      const relabel = () =>
        page.evaluate((labels) => {
          for (const input of document.querySelectorAll('input')) {
            input.value = labels.reduce((out, [value, name]) => out.replaceAll(value, name), input.value);
          }
        }, LABELS);
      const steps = [];
      const note = async (step) => {
        await relabel();
        steps.push({ step, ...(await readback(page, requests)) });
      };
      await page.locator('li:has(#git-webhook-url)').scrollIntoViewIfNeeded();
      await note('ready: a stored secret, masked');
      await pause();
      await rotateButton(page, locale).click();
      await pause();
      await note('Rotate pressed: held, busy');
      await answer(0, 'refused');
      await pause(1400);
      await note('refused: one toast, ready');
      await rotateButton(page, locale).click();
      await pause();
      await go(page, { site: SITE_B, away: false });
      await pause();
      await go(page, { site: SITE_A, away: false });
      await pause();
      await page.locator('li:has(#git-webhook-url)').scrollIntoViewIfNeeded();
      await note('Rotate pressed, the tab left and reopened: still busy, so it cannot be pressed again');
      await answer(1);
      await pause(1400);
      await note('stored and read back: no reveal or toast in the reopened tab');
      await rotateButton(page, locale).click();
      await pause(600);
      await answer(2);
      await pause(1400);
      await note('pressed again: stored, read back, revealed with one toast');
      await pause(1200);
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      const step = (prefix) => steps.find(({ step: name }) => name.startsWith(prefix));
      assert.equal(step('Rotate pressed').rotate.busy, true);
      assert.deepEqual(step('refused').toasts, [msg(locale, 'settings.git.webhook.rotateError')]);
      assert.equal(step('Rotate pressed, the tab').rotate.busy, true);
      assert.equal(step('Rotate pressed, the tab').posts.length, 2);
      assert.equal(step('stored and read back').secret.revealed, false);
      assert.deepEqual(step('pressed again: stored').secret, { value: '<credential#3>', revealed: true });
      assert.ok(steps.every(({ retained }) => retained.mutations === 0 && retained.byMutations.length === 0));
      recordings.push({ file, version: 'after', locale, width, theme: 'light', pageErrors: errors, steps });
    }

    assert.equal(attempted.length, 0);
    const evidence = { captures, recordings };
    for (const [value] of LABELS) assert.ok(!JSON.stringify(evidence).includes(value), 'a placeholder in evidence.json is unlabelled');
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's GitTab, features/site-git and useRotateGitWebhookSecret at ${BASE} and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient and the settings query; rotation requests answered by interception (stored with the next fictional secret, or refused), optionally held; offline by the browser's own emulation; fictional sites and secrets written as <id#n> and <credential#n> labels; not the signed-in dashboard, production or the server; no real key or secret rotated`,
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
