// Isolated component fixture of AI answers → a source card → Manage key (the site's own OpenAI key): main's
// ProviderKeyForm with its TanStack key hooks (before) and this branch's form with its direct Check and Save (after),
// with the real design system, EN/AR catalogs and the app's own QueryClient. Every API request is answered by
// interception on the fixture origin; a Check can be held until the script answers it. Not the signed-in dashboard and
// not production. No server starts and no request reaches a provider: the keys are fictional placeholders
// (`test-key-000n`), masked on screen, and evidence.json writes each request body with the key as a label (`<KEY_A>`).
//
// The before side is immutable: main's provider-key-form.tsx, features/site-ai/api/hooks.ts and
// hooks/api/workspace-ai.ts at BASE (read with `git show`). Everything else it imports is checked to be unchanged since
// BASE, so neither side mixes in a module this branch changed.
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
/** A message by its id as the code names it (`settings.smartAi.verifyModels`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://ai-provider-key.fixture.test';
/** The main commit this branch starts from (#797), pinned; evidence.json records it as `base`. */
const BASE = 'dd302202092fbb2775df3f0c7605086c7225bc16';
/** Fictional, low-entropy placeholders, nothing like a provider key. */
const KEYS = { A: 'test-key-0001', B: 'test-key-0002' };
const keyLabel = (value) => (value === KEYS.A ? '<KEY_A>' : value === KEYS.B ? '<KEY_B>' : value ? '<OTHER>' : '');
const MODELS = ['fixture-model-a', 'fixture-model-b'];

/** Everything main's form imports outside the three before-side files: unchanged since BASE, or the before side would mix. */
const BEFORE = {
  'before/components/provider-key-form.tsx': 'apps/app/src/features/site-ai/components/provider-key-form.tsx',
  'before/api/hooks.ts': 'apps/app/src/features/site-ai/api/hooks.ts',
  'before/workspace-ai.ts': 'apps/app/src/hooks/api/workspace-ai.ts',
};
const SHARED = [
  'apps/app/src/features/site-ai/model',
  'apps/app/src/features/site-ai/api/query-options.ts',
  'apps/app/src/hooks/api',
  'apps/app/src/components/secret-input.tsx',
  'apps/app/src/services',
  'apps/app/src/integrations/tanstack-query',
  'packages/design-system/src',
  'packages/i18n',
  'packages/validators/src',
];
// The before side takes hooks/api/workspace-ai.ts from BASE; its test file is not part of either side.
const OWN = ['apps/app/src/hooks/api/workspace-ai.ts', 'apps/app/src/hooks/api/workspace-ai.test.tsx'].map((file) => `:(exclude)${file}`);
assert.equal(git('diff', '--name-only', BASE, '--', ...SHARED, ...OWN), '', 'a module both sides share changed since BASE');

let harness;
try {
  harness = await mkdtemp(resolve(app, '.ai-provider-key-capture-'));
  for (const [target, file] of Object.entries(BEFORE)) {
    await mkdir(dirname(resolve(harness, target)), { recursive: true });
    const source = git('show', `${BASE}:${file}`)
      .replaceAll("from '../model/", "from '@/features/site-ai/model/")
      .replace("from './query-options'", "from '@/features/site-ai/api/query-options'")
      .replace("from '@/hooks/api/workspace-ai'", "from '../workspace-ai'")
      .replace(/from '\.\/(client-helpers|errors|query-keys)'/g, "from '@/hooks/api/$1'");
    await writeFile(resolve(harness, target), source);
  }
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-ai";\n@source "../src/components";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProviderKeyForm as After } from '@/features/site-ai/components/provider-key-form';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { ProviderKeyForm as Before } from './before/components/provider-key-form';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = createQueryClient();
const fixture = window as unknown as { mutations: () => number };
fixture.mutations = () => client.getMutationCache().getAll().length;
const Form = params.get('version') === 'before' ? Before : After;
/** The source card's Manage key / Done toggle, which mounts and unmounts the form as the AI answers page does. */
function Card() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button className="mb-3 rounded border px-3 py-1 text-sm" data-testid="toggle" onClick={() => setOpen(!open)} type="button">{open ? 'Done' : 'Manage key'}</button>
      {open ? <Form projectId="site-a" providerId="openai" /> : null}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
      <main className="mx-auto w-full max-w-xl px-4 pt-6 pb-24 text-foreground"><Card /></main>
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
    define: { 'import.meta.env.VITE_APP_URL': JSON.stringify(origin) },
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
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
  const STATUS = {
    encryptionConfigured: true,
    providers: [{ id: 'openai', configured: true, revision: 2, verified: true, verifiedAt: null, answerModel: MODELS[0] }],
  };

  /**
   * Opens the fixture on site A with a saved OpenAI key. The status GET answers it. A Check POST is recorded with its
   * key as a label, dropped as disconnected while `server.offline`, held while `server.hold` (until `server.release()`), refused with a 400 that echoes the key if
   * `server.refuse` (once), else answered with the fictional models. Any other API call fails the run.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const held = [];
    const server = { hold: false, refuse: false, offline: false, release: () => held.shift()?.(), held: () => held.length };
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}`;
      if (call === 'GET /api/app/projects/site-a/settings/ai') return json(route, { data: STATUS });
      if (call === 'POST /api/app/projects/site-a/settings/ai/models') {
        const body = JSON.parse(request.postData() ?? 'null');
        requests.push({ call, body: { ...body, ...(body.apiKey ? { apiKey: keyLabel(body.apiKey) } : {}) } });
        // Offline, a request that is sent fails as a dropped connection.
        if (server.offline) return route.abort('internetdisconnected');
        if (server.hold) await new Promise((done) => held.push(done));
        if (server.refuse) {
          server.refuse = false;
          return json(route, { error: { code: 'integration:credentials_invalid', message: `Refused ${body.apiKey}` } }, 400);
        }
        return json(route, { data: { models: MODELS.map((id) => ({ id })) } });
      }
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('input[name="ai-provider-api-key"]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const settle = (page, ms = 400) => page.waitForTimeout(ms);
  const arrived = async (page, server, count = 1) => {
    for (let tries = 0; server.held() < count && tries < 100; tries += 1) await page.waitForTimeout(50);
    assert.ok(server.held() >= count);
  };
  const checkButton = (page, locale) => page.locator('button', { hasText: msg(locale, 'settings.smartAi.verifyModels') });
  const type = (page, key) => page.locator('input[name="ai-provider-api-key"]').fill(key);
  const press = (page, locale) => checkButton(page, locale).click();
  /** Done, then Manage key: the panel closes and opens again with a new form. */
  const reopen = async (page) => {
    await page.getByTestId('toggle').click();
    await settle(page, 300);
    await page.getByTestId('toggle').click();
    await page.locator('input[name="ai-provider-api-key"]').waitFor();
  };
  /** What a reviewer should see: the key field (as a label), Check, the models line, toasts, and the MutationCache size. */
  const readback = (page, locale) =>
    page.evaluate(
      async ({ keys, verify }) => {
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
        const field = document.querySelector('input[name="ai-provider-api-key"]');
        const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes(verify));
        const value = field?.value ?? null;
        return {
          dir: document.documentElement.dir,
          key: value === null ? null : value === keys.A ? '<KEY_A>' : value === keys.B ? '<KEY_B>' : value ? '<OTHER>' : '',
          keyMasked: field ? getComputedStyle(field).getPropertyValue('-webkit-text-security') === 'disc' : null,
          check: button ? { busy: button.getAttribute('aria-busy') === 'true', disabled: button.disabled } : null,
          models: document.querySelector('[role="status"]')?.textContent ?? null,
          toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
          mutations: window.mutations(),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      },
      { keys: KEYS, verify: msg(locale, 'settings.smartAi.verifyModels') },
    );

  /** Each state, run on both versions: what the person did before the screenshot. */
  const STATES = {
    verified: {
      label: 'Key A, Check, models loaded (control)',
      run: async ({ page, locale }) => {
        await type(page, KEYS.A);
        await press(page, locale);
        await settle(page, 700);
      },
    },
    refused: {
      label: 'Key A, Check, refused (400) (control)',
      run: async ({ page, server, locale }) => {
        await type(page, KEYS.A);
        server.refuse = true;
        await press(page, locale);
        await settle(page, 700);
      },
    },
    closedRefusal: {
      label: 'Key A checked (held), the panel closed (Done) and opened again, then A refused (400)',
      run: async ({ page, server, locale }) => {
        await type(page, KEYS.A);
        server.hold = true;
        server.refuse = true;
        await press(page, locale);
        await arrived(page, server);
        await reopen(page);
        server.hold = false;
        server.release();
        await settle(page, 700);
      },
    },
    sameTick: {
      label: 'Key A, Check pressed three times in one task (held)',
      run: async ({ page, server, locale }) => {
        await type(page, KEYS.A);
        server.hold = true;
        await checkButton(page, locale).evaluate((button) => {
          for (let press = 0; press < 3; press += 1) button.click();
        });
        await arrived(page, server);
        await settle(page);
      },
    },
    offline: {
      label: 'Offline: key A, Check',
      run: async ({ page, server, locale, context }) => {
        await type(page, KEYS.A);
        server.offline = true;
        await context.setOffline(true);
        // The browser's own offline signal, which TanStack's onlineManager follows.
        await page.evaluate(() => window.dispatchEvent(new Event('offline')));
        await press(page, locale);
        await settle(page, 700);
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
            const { page, errors, requests, server } = await open(context, { locale, version });
            await run({ page, server, locale, context });
            const read = await readback(page, locale);
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            assert.deepEqual(errors, []);
            assert.equal(read.keyMasked, true, 'the key field is masked in every screenshot');
            await page.mouse.move(0, 0);
            shots[`${locale}-${state}-${version}`] = await page.screenshot({ animations: 'disabled', fullPage: true });
            seen[`${locale}-${state}-${version}`] = { ...read, requests: requests.map((item) => ({ ...item })) };
            server.hold = false;
            while (server.held()) server.release();
            await context.close();
          }
        }
        const at = (state, version) => seen[`${locale}-${state}-${version}`];
        const checkA = { call: 'POST /api/app/projects/site-a/settings/ai/models', body: { providerId: 'openai', apiKey: '<KEY_A>' } };
        const invalidKey = msg(locale, 'settings.smartAi.invalidKey');
        for (const version of ['before', 'after']) {
          // Controls: the models show after a success; a refusal says the key was refused, once.
          assert.deepEqual(at('verified', version).requests, [checkA]);
          assert.equal(at('verified', version).models, msg(locale, 'settings.smartAi.modelsVerified'));
          assert.deepEqual(at('refused', version).toasts, [invalidKey]);
          assert.deepEqual([at('closedRefusal', version).key, at('closedRefusal', version).models], ['', null]);
        }
        // Main keeps a mutation (holding the key) after a Check; here none, ever.
        assert.ok(at('verified', 'before').mutations > 0);
        for (const state of Object.keys(STATES)) assert.equal(at(state, 'after').mutations, 0);
        // Main toasts A's refusal over the reopened, empty form; here nothing.
        assert.deepEqual(at('closedRefusal', 'before').toasts, [invalidKey]);
        assert.deepEqual(at('closedRefusal', 'after').toasts, []);
        // Main sends three Checks for three presses in a task; here one, busy.
        assert.equal(at('sameTick', 'before').requests.length, 3);
        assert.deepEqual(at('sameTick', 'after').requests, [checkA]);
        assert.equal(at('sameTick', 'after').check.busy, true);
        // Offline: main pauses the Check (busy, nothing sent) to replay it later; here it is tried now and fails plainly.
        assert.deepEqual([at('offline', 'before').requests.length, at('offline', 'before').check.busy], [0, true]);
        assert.deepEqual([at('offline', 'after').check.busy, at('offline', 'after').toasts], [false, [msg(locale, 'error.network')]]);
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(width * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const caption = (key) => {
        const { requests, toasts, key: field, check, models, mutations } = seen[key];
        return `field ${field || 'empty'} · Checks sent ${requests.length} · Check ${check ? (check.busy ? 'busy' : check.disabled ? 'disabled' : 'ready') : 'n/a'} · models ${models ? 'shown' : 'none'} · toasts ${toasts.length} · mutations kept ${mutations}`;
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
<div><b>Component fixture</b> (not the dashboard, not production) · AI answers → OpenAI key · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional site, placeholder keys (masked; shown here as labels), every request intercepted, nothing sent to a provider</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (main ${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', states: seen });
    }

    // Key A → Check (held) → Done → Manage key → A refused → key B → Check → models, on both versions.
    for (const version of ['before', 'after']) {
      const locale = 'en';
      const width = 1440;
      const file = `flow-${version}-${locale}-${width}.webm`;
      const context = await browser.newContext({
        viewport: { width, height: 720 },
        reducedMotion: 'reduce',
        recordVideo: { dir: harness, size: { width, height: 720 } },
      });
      const { page, errors, requests, server } = await open(context, { locale, version });
      const pause = (ms = 700) => page.waitForTimeout(ms);
      const steps = [];
      const note = async (moment) => steps.push({ moment, ...(await readback(page, locale)), requests: requests.map((item) => ({ ...item })) });
      await pause();
      await type(page, KEYS.A);
      server.hold = true;
      server.refuse = true;
      await press(page, locale);
      await arrived(page, server);
      await pause();
      await note('key A, Check held');
      await reopen(page);
      await pause();
      await note('panel closed and opened again while A is checked');
      server.hold = false;
      server.release();
      await pause(1500);
      await note('A answered: refused');
      await type(page, KEYS.B);
      await press(page, locale);
      await pause(1500);
      await note('key B, Check: models');
      await pause(800);
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, version, locale, width, theme: 'light', pageErrors: errors, steps });
    }
    const flow = (version, prefix) => recordings.find((item) => item.version === version).steps.find(({ moment }) => moment.startsWith(prefix));
    // Closing the panel retired A's Check here: its refusal toasts nothing. Main toasts it over the new form.
    for (const version of ['before', 'after']) {
      assert.equal(flow(version, 'panel closed').check.busy, false);
      assert.equal(flow(version, 'key B').models, msg('en', 'settings.smartAi.modelsVerified'));
    }
    assert.deepEqual(flow('after', 'A answered').toasts, []);
    assert.deepEqual(flow('before', 'A answered').toasts, [msg('en', 'settings.smartAi.invalidKey')]);

    assert.equal(attempted.length, 0);
    const evidence = {
      environment: `Component fixture: main's ProviderKeyForm with features/site-ai/api/hooks.ts and hooks/api/workspace-ai.ts (${BASE}) and this branch's, with the real design system, EN/AR catalogs and the app's QueryClient; each Check POST answered by interception (fictional models, or a 400 that echoes the key), optionally held; a fictional site; placeholder keys written as <KEY_A>/<KEY_B> labels and masked on screen; not the signed-in dashboard, production, the server or a provider`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      recordings,
    };
    const written = JSON.stringify(evidence);
    for (const key of Object.values(KEYS)) assert.ok(!written.includes(key), 'no key value in evidence.json');
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), evidence);
  });
  console.log(`${captures.length} before/after sheets and ${recordings.length} recordings; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
