// Isolated component fixture of Settings → Integrations → Slack (Connect / Save): main's IntegrationsTab (before)
// and this branch's (after), with the real design system, EN/AR catalogs, the app's QueryClient and API module, for
// a fictional site. The catalog offers Slack as `available` (production marks it `coming_soon` today). Every API
// request is answered by interception on the fixture origin; no server starts, and nothing reaches Slack, Discord
// or Zapier. Every webhook URL is a fictional `.example.test` fixture, masked on screen by the field and replaced
// by a label in evidence.json, as is every idempotency key.
//
// Run it while holding the repository's heavy-step lock; it takes no lock itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { INTEGRATION_CATALOG } from '../../../packages/shared/src/integrations.ts';
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
/** A message by its id as the code names it (`settings.integrations.connect`), with `{name}` filled. */
const msg = (locale, id, vars = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
const origin = 'http://integration-webhook.fixture.test';
/** The main commit this branch starts from, pinned; evidence.json records it as `base`. */
const BASE = 'dd302202092fbb2775df3f0c7605086c7225bc16';
const SITE = 'site-1';
const LIST = `GET /api/app/projects/${SITE}/integrations`;
const CREATE = `POST /api/app/projects/${SITE}/integrations`;
const UPDATE = `PATCH /api/app/projects/${SITE}/integrations/slack`;
// Fictional, low-entropy fixtures; never real credentials.
const URLS = {
  'fixture-url:A': 'https://hooks.example.test/services/T0FIXTURE/B0FIXTURE/fixture-webhook-aaaa',
  'fixture-url:B': 'https://hooks.example.test/services/T0FIXTURE/B0FIXTURE/fixture-webhook-bbbb',
};
const [URL_A, URL_B] = Object.values(URLS);
const connection = (revision, label) => ({
  id: 'connection-fixture-1',
  providerId: 'slack',
  category: 'webhook',
  ownership: 'project',
  status: 'active',
  health: { status: 'unverified', checkedAt: null, code: null },
  credential: { configured: true },
  config: { providerId: 'slack', label },
  revision,
  createdAt: '2026-11-16T09:00:00.000Z',
  updatedAt: '2026-11-16T09:00:00.000Z',
});
/** A refusal that echoes the URL it was sent (the fixture invents it; no provider is reached). */
const ECHOED = { status: 422, body: { error: { code: 'integration:credentials_invalid', message: `Webhook ${URL_A} was refused.` } } };

/** Evidence never holds a URL or a key: each URL by its label, each idempotency key by a synthetic label in order of use. */
const keyLabels = new Map();
const masked = (value) => {
  let text = JSON.stringify(value);
  for (const [label, url] of Object.entries(URLS)) text = text.replaceAll(url, `<${label}>`);
  text = text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (key) => {
    if (!keyLabels.has(key)) keyLabels.set(key, `<synthetic-idempotency-key#${keyLabels.size + 1}>`);
    return keyLabels.get(key);
  });
  assert.ok(!text.includes('fixture-webhook-'), 'evidence never holds a fixture URL');
  return JSON.parse(text);
};

let harness;
try {
  harness = await mkdtemp(resolve(app, '.integration-webhook-capture-'));
  await mkdir(resolve(harness, 'before'), { recursive: true });
  // Main's tab and its integration hooks as they are on the base: Connect and Save were mutations there
  // (useCreateProjectIntegration, useUpdateProjectIntegration), gone from the app here; every other import is today's.
  await writeFile(
    resolve(harness, 'before/integrations-tab.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/integrations-tab.tsx`)
      .replace(/from '\.\/([\w-]+)'/g, "from '@/components/settings/$1'")
      .replace("from '@/hooks/api'", "from './hooks'"),
  );
  await writeFile(
    resolve(harness, 'before/integrations-hooks.ts'),
    git('show', `${BASE}:apps/app/src/hooks/api/integrations.ts`).replace(/from '\.\/([\w-]+)'/g, "from '@/hooks/api/$1'"),
  );
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    "export * from '@/hooks/api';\nexport { useCreateProjectIntegration, useUpdateProjectIntegration } from './integrations-hooks';\n",
  );
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/components";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { dehydrate, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { IntegrationsTab as After } from '@/components/settings/integrations-tab';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { IntegrationsTab as Before } from './before/integrations-tab';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = createQueryClient();
const logged = [];
const log = console.error.bind(console);
console.error = (...items) => {
  logged.push(items.map((item) => (item instanceof Error ? item.message : String(item))).join(' '));
  log(...items);
};
const has = (value) => JSON.stringify(value)?.includes('fixture-webhook-') ?? false;
/** Where the app still keeps a fixture URL: names only, never the value. */
window.__holders = () => {
  const found = [];
  client.getMutationCache().getAll().forEach((mutation, index) => {
    if (has(mutation.state.variables)) found.push(\`mutation \${index + 1} variables (\${mutation.state.status}\${mutation.state.isPaused ? ', paused' : ''})\`);
    if (has([String(mutation.state.error ?? ''), mutation.state.error?.message])) found.push(\`mutation \${index + 1} error\`);
  });
  if (has(client.getQueryCache().getAll().map(({ state }) => [state.data, String(state.error ?? '')]))) found.push('query cache');
  if (has(dehydrate(client))) found.push('dehydrate (default)');
  else if (has(dehydrate(client, { shouldDehydrateMutation: () => true, shouldDehydrateQuery: () => true }))) found.push('dehydrate (all)');
  if (has(logged)) found.push('console.error');
  return found;
};
function Probe() {
  const [holders, setHolders] = useState([]);
  useEffect(() => {
    const timer = setInterval(() => setHolders(window.__holders()), 100);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="mb-4 rounded-md border border-dashed px-3 py-2 font-mono text-xs" data-probe="" dir="ltr">
      Fixture probe (not product UI) · app state holding the typed URL: <b>{holders.length ? holders.join(', ') : 'none'}</b>
    </div>
  );
}
const Tab = params.get('version') === 'before' ? Before : After;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 text-foreground sm:px-8">
        <Probe />
        <Tab key="integrations-${SITE}" project={{ id: '${SITE}', name: 'Fixture docs' }} projectId="${SITE}" />
      </main>
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
      // The tab only navigates to other settings sections (not used here); there is no router in the fixture.
      {
        name: 'no-router',
        enforce: 'pre',
        resolveId: (source, importer) =>
          source === '@tanstack/react-router' && importer?.replaceAll('\\', '/').endsWith('/integrations-tab.tsx') ? '\0no-router' : undefined,
        load: (id) => (id === '\0no-router' ? 'export const useNavigate = () => () => undefined;' : undefined),
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
   * Opens the fixture on the Slack panel. `server.stored` is the stored connection (or null). A write waits
   * `server.delay` ms, or, with `server.hold`, until `server.release()`; then it answers `server.answers.shift()`,
   * or stores and answers as the server does (a revision mismatch is a 409 revision conflict).
   */
  async function open(context, { locale, version, stored = null }) {
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    const reads = [];
    const held = [];
    const server = { stored, delay: 0, hold: false, answers: [], release: () => held.shift()?.() };
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === LIST) {
        reads.push(call);
        const data = INTEGRATION_CATALOG.filter(({ category }) => category === 'webhook').map((manifest) => ({
          ...manifest,
          availability: 'available',
          connection: manifest.id === 'slack' ? server.stored : null,
        }));
        return json(route, { data });
      }
      if (call === CREATE || call === UPDATE) {
        const body = request.postDataJSON();
        writes.push({ call, body });
        if (server.hold) await new Promise((done) => held.push(done));
        else await wait(server.delay);
        const answer = server.answers.shift();
        if (answer) return json(route, answer.body, answer.status);
        if (call === UPDATE && server.stored?.revision !== body.expectedRevision) {
          return json(route, { error: { code: 'integration:revision_conflict', message: 'The integration changed.' } }, 409);
        }
        server.stored = connection((server.stored?.revision ?? 0) + 1, body.label ?? null);
        return json(route, { data: server.stored });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    const card = page.locator('button', { hasText: msg(locale, 'settings.integrations.provider.slack') });
    await card.waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await card.click();
    await page.locator('#slack-url').waitFor();
    return { page, errors, writes, reads, server };
  }

  const submit = (page) => page.locator('form button[type="submit"]');
  /** What a reviewer should see: the fields (the URL by its label), the submit button, toasts and the probe. */
  const state = async (page) => {
    const seen = await page.evaluate(() => {
      const button = document.querySelector('form button[type="submit"]');
      return {
        dir: document.documentElement.dir,
        label: document.getElementById('slack-label')?.value ?? null,
        url: document.getElementById('slack-url')?.value ?? null,
        urlMasked: document.getElementById('slack-url')?.hasAttribute('data-masked') ?? false,
        submit: button?.textContent?.trim(),
        submitBusy: button?.getAttribute('aria-busy') === 'true',
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
        holders: window.__holders(),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    return masked(seen);
  };
  const waitFor = async (page, check) => {
    for (let tries = 0; !check() && tries < 100; tries += 1) await page.waitForTimeout(50);
    await page.waitForTimeout(400);
  };

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
        const shoot = async (key, page, { writes, reads, errors }) => {
          await page.waitForTimeout(300);
          const seen = await state(page);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.overflow, false, `${key} overflows at ${width}px`);
          assert.equal(seen.urlMasked, true);
          assert.deepEqual(errors, []);
          shots[key] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          seenBy[key] = { ...seen, writes: masked(writes), catalogReads: reads.length };
          return seen;
        };
        const after = (version) => version === 'after';
        for (const version of ['before', 'after']) {
          // Connect held, the URL corrected while it runs, then its answer.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version });
            const { page, server, writes } = opened;
            await shoot(`${version}-ready`, page, opened);
            server.hold = true;
            await page.locator('#slack-url').fill(URL_A);
            await submit(page).click();
            await waitFor(page, () => writes.length >= 1);
            await page.locator('#slack-url').fill(URL_B);
            const pending = await shoot(`${version}-heldCorrected`, page, opened);
            assert.equal(pending.submitBusy, true);
            if (after(version)) assert.deepEqual(pending.holders, []);
            else assert.ok(pending.holders.includes('mutation 1 variables (pending)'));
            server.release();
            await waitFor(page, () => opened.reads.length >= 2);
            const answered = await shoot(`${version}-answered`, page, opened);
            assert.equal(answered.url, after(version) ? '<fixture-url:B>' : '');
            const name = msg(locale, 'settings.integrations.provider.slack');
            assert.deepEqual(answered.toasts, after(version) ? [] : [msg(locale, 'settings.integrations.connectedToast', { name })]);
            assert.equal(answered.holders.length === 0, after(version));
            await context.close();
          }
          // A refusal that echoes the URL.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version });
            const { page, server } = opened;
            server.answers.push(ECHOED);
            await page.locator('#slack-url').fill(URL_A);
            await submit(page).click();
            await page.waitForTimeout(600);
            const refused = await shoot(`${version}-echoedRefusal`, page, opened);
            assert.deepEqual(refused.toasts, [msg(locale, 'settings.integrations.errorCredentialsInvalid')]);
            assert.equal(refused.url, '<fixture-url:A>');
            if (after(version)) assert.deepEqual(refused.holders, []);
            else assert.ok(refused.holders.includes('mutation 1 error'));
            await context.close();
          }
          // Someone else saved first: the label and a new URL are being edited, Save meets a revision conflict.
          {
            const context = await newContext();
            const opened = await open(context, { locale, version, stored: connection(3, 'Alerts') });
            const { page, server } = opened;
            await page.locator('#slack-label').fill('Mine');
            await page.locator('#slack-url').fill(URL_A);
            server.stored = connection(4, 'Theirs');
            await submit(page).click();
            await waitFor(page, () => opened.reads.length >= 2);
            const conflict = await shoot(`${version}-conflict`, page, opened);
            assert.deepEqual(conflict.toasts, [msg(locale, 'error.conflict')]);
            assert.deepEqual(
              { label: conflict.label, url: conflict.url },
              after(version) ? { label: 'Mine', url: '<fixture-url:A>' } : { label: 'Theirs', url: '' },
            );
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
          ['ready', 'Slack, not connected: the same form'],
          ['heldCorrected', 'Connect held, URL corrected during it: before, the mutation holds the URL'],
          ['answered', 'Its answer: before wipes the corrected URL and says connected; after keeps it, quietly'],
          ['echoedRefusal', 'A refusal echoing the URL: the same message; before keeps it in the mutation error'],
          ['conflict', 'Label and URL edited, someone else saved first: before drops both; after keeps them'],
        ]
          .map(
            ([key, label]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(locale, `before-${key}`)}</div><div>${panel(locale, `after-${key}`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Integrations → Slack · ${width}px${scale < 1 ? ' (shown at 50%)' : ''} · fictional site and URLs (masked), every request intercepted, Slack offered as available</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', ...seenByLocale });
    }

    // Connect held → URL corrected → kept → Save it → someone else saves → conflict, edits kept → Save again.
    const locale = 'en';
    const width = 1440;
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 900 } },
    });
    const { page, errors, writes, reads, server } = await open(context, { locale, version: 'after' });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page)), writesSoFar: writes.length, catalogReads: reads.length });
    await pause();
    await note('ready');
    await page.locator('#slack-label').fill('Releases');
    await page.locator('#slack-url').fill(URL_A);
    server.delay = 1800;
    await submit(page).click();
    await pause(400);
    await note('Connect sent: busy');
    await page.locator('#slack-url').fill(URL_B);
    await pause(300);
    await note('URL corrected during the send: still busy');
    await pause(2000);
    await note('answered: connected, the corrected URL kept, nothing said');
    server.delay = 1500;
    await submit(page).click();
    await pause(400);
    await note('Save (the corrected URL): busy');
    await pause(2000);
    await note('saved once, URL cleared');
    await page.locator('#slack-label').fill('Mine');
    server.stored = connection(server.stored.revision + 1, 'Theirs');
    server.delay = 600;
    await submit(page).click();
    await pause(1600);
    await note('someone else saved first: one conflict message, the label edit kept');
    await submit(page).click();
    await pause(1600);
    await note('saved again on the new revision');
    await pause(1000);

    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    const sent = masked(writes);
    assert.deepEqual(
      sent.map(({ call, body }) => [call, body.webhookUrl ?? null, body.expectedRevision ?? null, body.label]),
      [
        [CREATE, '<fixture-url:A>', null, 'Releases'],
        [UPDATE, '<fixture-url:B>', 1, 'Releases'],
        [UPDATE, null, 2, 'Mine'],
        [UPDATE, null, 3, 'Mine'],
      ],
    );
    assert.equal(at('Connect sent').submitBusy, true);
    assert.equal(at('URL corrected').submitBusy, true);
    assert.equal(at('answered').url, '<fixture-url:B>');
    assert.deepEqual(at('answered').toasts, []);
    assert.equal(at('saved once').url, '');
    assert.ok(at('saved once').toasts.includes(msg(locale, 'settings.integrations.updatedToast')));
    assert.equal(at('someone else').label, 'Mine');
    assert.ok(at('someone else').toasts.includes(msg(locale, 'error.conflict')));
    for (const step of steps) assert.deepEqual(step.holders, []);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', writes: sent, catalogReads: reads.length, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's IntegrationsTab (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient and API module; a fictional site; Slack served as available (production: coming_soon); every request answered by interception; URLs fictional and shown here by label, idempotency keys labelled; not the signed-in dashboard, production, the server or a real provider`,
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
