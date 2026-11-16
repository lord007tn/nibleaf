// Isolated component fixture of Settings → Git → Repository settings (the
// legacy import's connection form): main's GitTab (before) and this branch's
// (after) with the real design system, EN/AR catalogs, settings queries and
// mutations, for a fictional site. Every API request is answered by
// interception on the fixture origin; the settings PATCH goes through the real
// body validator and main's stored-shape rules (wholesale `git`, bookkeeping
// carried over). Not the signed-in dashboard and not production. No server
// starts, and no repository is imported, built or deployed anywhere.
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
/** A message by its id as the code names it (`settings.git.repoSaved`). */
const msg = (locale, id, values = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const origin = 'http://git-connection.fixture.test';
/** The main commit this branch starts from (#778); evidence.json records it as `base`. */
const BASE = 'b5c9c7977e4b93246290c2c934f722fce090b664';
const SITE = 'site-1';
const SETTINGS = `/api/app/projects/${SITE}/settings`;
/** What the site stores: a connected GitHub import with auto publish on and the server's bookkeeping. */
const STORED = {
  connected: true,
  provider: 'github',
  repo: 'acme-fixture/docs',
  branch: 'main',
  path: 'docs',
  autoPublish: true,
  lastImportedAt: '2026-11-15T09:00:00.000Z',
  lastSyncAt: '2026-11-15T10:30:00.000Z',
  lastSyncStatus: 'ok',
};
const SERVER_MANAGED = ['lastImportedAt', 'lastSyncAt', 'lastSyncStatus', 'lastSyncError'];

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-connection-capture-'));
  await mkdir(resolve(harness, 'before'), { recursive: true });
  await writeFile(
    resolve(harness, 'before/git-tab.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/git-tab.tsx`)
      .replace("from './git-workflow'", "from '@/components/settings/git-workflow'")
      .replace("from './section'", "from '@/components/settings/section'"),
  );
  // The per-site connection above the legacy form is out of scope: rendered as nothing on both sides.
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
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { GitTab as After } from '@/components/settings/git-tab';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { GitTab as Before } from './before/git-tab';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = createQueryClient();
// The fixture's "someone else saved": the script changes the stored settings, then asks for a refetch.
(window as unknown as { refetchSettings: () => Promise<void> }).refetchSettings = () =>
  client.invalidateQueries({ queryKey: ['workspace', 'settings', '${SITE}'] });
const Tab = params.get('version') === 'before' ? Before : After;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
        <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Tab projectId="${SITE}" /></main>
      </DirectionProvider>
      <Toaster theme="light" />
    </ConfirmProvider>
  </QueryClientProvider>,
);
`,
  );
  const { build } = await fromApp('vite');
  // The real settings validator, bundled for the fixture's PATCH handler.
  await build({
    configFile: false,
    logLevel: 'error',
    build: {
      ssr: resolve(root, 'packages/validators/src/index.ts'),
      outDir: resolve(harness, 'validators'),
      rollupOptions: { output: { entryFileNames: 'index.mjs' } },
    },
    ssr: { noExternal: true },
  });
  const { updateWorkspaceSettingsBody } = await import(pathToFileURL(resolve(harness, 'validators/index.mjs')).href);
  const stub = resolve(harness, 'git-workflow-stub.tsx');
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
   * Opens the fixture. The settings GET returns `server.git` (and the webhook
   * secret, as to an admin). A PATCH is held while `server.hold` (until
   * `server.release()`), then refused with 500 if `server.fail` (once), else
   * validated by the real body validator (400 when refused) and stored as main
   * stores it. Reads of branches, languages, deployments and the per-site
   * connection get fixed answers; any other API call fails the run.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const held = [];
    const server = {
      git: { ...STORED },
      hold: false,
      fail: false,
      release: () => held.shift()?.(),
      held: () => held.length,
    };
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}${url.search}`;
      if (call === `GET ${SETTINGS}`) {
        requests.push({ call });
        return json(route, { data: { plan: 'free', notifications: {}, integrations: {}, git: { ...server.git, webhookSecret: 'f1c7f1c7' } } });
      }
      if (call === `PATCH ${SETTINGS}`) {
        const body = request.postDataJSON();
        requests.push({ call, body });
        if (server.hold) await new Promise((done) => held.push(done));
        if (server.fail) {
          server.fail = false;
          return json(route, { error: { message: 'Could not save.' } }, 500);
        }
        const parsed = updateWorkspaceSettingsBody.safeParse(body);
        if (!parsed.success) return json(route, { error: { message: parsed.error.issues[0]?.message ?? 'Invalid.' } }, 400);
        const next = { ...parsed.data.git };
        for (const key of SERVER_MANAGED) if (next[key] === undefined && server.git[key] !== undefined) next[key] = server.git[key];
        server.git = JSON.parse(JSON.stringify(next));
        return json(route, { data: { plan: 'free', notifications: {}, integrations: {}, git: { ...server.git, webhookSecret: 'f1c7f1c7' } } });
      }
      if (call === `GET /api/app/projects/${SITE}/branches`) return json(route, { data: [{ id: 'branch-draft', name: 'draft' }] });
      if (call === `GET /api/app/projects/${SITE}/languages`) return json(route, { data: [{ id: 'lang-en', code: 'en', label: 'English' }] });
      if (call === `GET /api/app/projects/${SITE}/git`) return json(route, { data: null });
      if (url.pathname === `/api/app/projects/${SITE}/deployments`) return json(route, { data: [] });
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('#git-repo').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const section = (page) => page.locator('section:has(#git-branch)').last();
  const submit = (page) => section(page).locator('button[type="submit"]');
  const settle = (page, ms = 300) => page.waitForTimeout(ms);
  const refetch = async (page) => {
    await page.evaluate(() => window.refetchSettings());
    await settle(page);
  };
  /** Waits for the held PATCH to arrive. */
  const arrived = async (page, server) => {
    for (let tries = 0; server.held() === 0 && tries < 100; tries += 1) await page.waitForTimeout(50);
    assert.equal(server.held(), 1);
  };
  /** What a reviewer should see: the fields, the Save button, Discard, the conflict callout, field errors and toasts. */
  const readback = (page) =>
    page.evaluate(() => {
      const value = (id) => document.getElementById(id)?.value ?? null;
      const form = document.querySelector('section:has(#git-branch) form');
      const save = form?.querySelector('button[type="submit"]');
      return {
        dir: document.documentElement.dir,
        repo: value('git-repo'),
        branch: value('git-branch'),
        path: value('git-path'),
        save: { text: save?.textContent?.replace(/\s+/g, ' ').trim(), busy: save?.getAttribute('aria-busy') === 'true' },
        buttons: [...(form?.querySelectorAll('button[type="button"]') ?? [])].map((node) => node.textContent?.trim()).filter(Boolean),
        conflict: Boolean(form?.querySelector('[data-slot="callout"], [role="alert"], [role="status"]')),
        invalid: [...(form?.querySelectorAll('[aria-invalid="true"]') ?? [])].map((node) => node.id),
        errors: [...(form?.querySelectorAll('p.text-destructive') ?? [])].map((node) => node.textContent),
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
        focused: document.activeElement?.id || document.activeElement?.tagName.toLowerCase() || null,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });

  /**
   * Each state, run on both versions: what the person did (and what another
   * writer did) before the screenshot.
   */
  const STATES = {
    ready: { label: 'Stored GitHub connection, nothing edited', run: async () => undefined },
    refetch: {
      label: 'Repository and path edited, then another writer changes the branch and the page refetches',
      run: async ({ page, server }) => {
        await page.locator('#git-repo').fill('acme-fixture/handbook');
        await page.locator('#git-path').fill('guides');
        server.git = { ...server.git, branch: 'release' };
        await refetch(page);
      },
    },
    duringSave: {
      label: 'Save held; the path is edited while it runs; the save succeeds',
      run: async ({ page, server }) => {
        await page.locator('#git-repo').fill('acme-fixture/handbook');
        server.hold = true;
        await page.locator('#git-repo').press('Enter');
        await arrived(page, server);
        await page.locator('#git-path').fill('guides');
        server.hold = false;
        server.release();
        await settle(page, 600);
      },
    },
    failed: {
      label: 'Save refused (500), then another writer changes the branch and the page refetches',
      run: async ({ page, server }) => {
        await page.locator('#git-repo').fill('acme-fixture/handbook');
        server.fail = true;
        await submit(page).click();
        await settle(page, 600);
        server.git = { ...server.git, branch: 'release' };
        await refetch(page);
      },
    },
    conflict: {
      label: 'Repository edited; another writer saves a different repository; the page refetches',
      run: async ({ page, server }) => {
        await page.locator('#git-repo').fill('acme-fixture/handbook');
        server.git = { ...server.git, repo: 'acme-fixture/manual' };
        await refetch(page);
      },
    },
    blank: {
      label: 'Repository cleared, then Save',
      run: async ({ page }) => {
        await page.locator('#git-repo').fill('');
        await submit(page).click();
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
            await run({ page, server });
            const read = await readback(page);
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            assert.deepEqual(errors, []);
            await page.mouse.move(0, 0);
            shots[`${locale}-${state}-${version}`] = await section(page).screenshot({ animations: 'disabled' });
            seen[`${locale}-${state}-${version}`] = { ...read, patches: requests.filter(({ call }) => call.startsWith('PATCH')), stored: server.git };
            await context.close();
          }
        }
        // The behaviour each sheet shows, asserted so a wrong capture fails the run.
        const at = (state, version) => seen[`${locale}-${state}-${version}`];
        assert.deepEqual([at('refetch', 'before').repo, at('refetch', 'before').path], ['acme-fixture/docs', 'docs']);
        assert.deepEqual(
          [at('refetch', 'after').repo, at('refetch', 'after').path, at('refetch', 'after').branch],
          ['acme-fixture/handbook', 'guides', 'release'],
        );
        assert.equal(at('duringSave', 'before').path, 'docs');
        assert.equal(at('duringSave', 'after').path, 'guides');
        assert.ok(at('duringSave', 'after').buttons.includes(msg(locale, 'forms.discard')));
        assert.ok(!at('duringSave', 'after').toasts.includes(msg(locale, 'settings.git.repoSaved')));
        assert.equal(at('failed', 'before').repo, 'acme-fixture/docs');
        assert.equal(at('failed', 'after').repo, 'acme-fixture/handbook');
        assert.equal(at('conflict', 'before').repo, 'acme-fixture/manual');
        assert.equal(at('conflict', 'after').repo, 'acme-fixture/handbook');
        assert.ok(at('conflict', 'after').buttons.includes(msg(locale, 'forms.useTheirs')));
        assert.equal(at('blank', 'before').patches.length, 1);
        assert.equal(at('blank', 'after').patches.length, 0);
        assert.deepEqual(at('blank', 'after').invalid, ['git-repo']);
        assert.equal(at('blank', 'after').focused, 'git-repo');
        // Unchanged where nothing changed: the same payload for the same save, field for field.
        assert.deepEqual(at('duringSave', 'after').patches[0].body, at('duringSave', 'before').patches[0].body);
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(Math.min(width, 768) * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const panel = (key) =>
        `<img src="data:image/png;base64,${shots[key].toString('base64')}" width="${shown}" style="display:block;border:1px solid #bbb">`;
      const rows = (locale) =>
        Object.entries(STATES)
          .map(
            ([state, { label }]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(`${locale}-${state}-before`)}</div><div>${panel(`${locale}-${state}-after`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Repository settings · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional site, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', states: seen });
    }

    // Held save → a refetch with another writer's branch while it runs → refused → retry → saved, on both versions.
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
      await section(page).scrollIntoViewIfNeeded();
      const pause = (ms = 700) => page.waitForTimeout(ms);
      const steps = [];
      const note = async (step) => steps.push({ step, ...(await readback(page)), stored: server.git, requestsSoFar: requests.length });
      await pause();
      await page.locator('#git-repo').fill('acme-fixture/handbook');
      await page.locator('#git-path').fill('guides');
      await pause();
      await note('edited: repository and path');
      server.hold = true;
      server.fail = true;
      await page.locator('#git-repo').press('Enter');
      await arrived(page, server);
      await pause(400);
      await note('save held: busy');
      server.git = { ...server.git, branch: 'release' };
      await page.evaluate(() => window.refetchSettings());
      await pause();
      await note('another writer changed the branch; refetched while the save is held');
      server.hold = false;
      server.release();
      await pause(1200);
      await note('save refused (500)');
      await submit(page).click();
      await pause(1200);
      await note('retried: saved');
      await pause(1200);
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, version, locale, width, theme: 'light', requests, pageErrors: errors, steps });
    }
    const flow = (version, prefix) => recordings.find((item) => item.version === version).steps.find(({ step }) => step.startsWith(prefix));
    // Main: the refetch during the held save wipes both edits, so the retry saves nothing new.
    assert.equal(flow('before', 'another writer').repo, 'acme-fixture/docs');
    // Here: both edits survive the refetch and the refusal, the branch follows the server, and the retry saves them.
    assert.equal(flow('after', 'save held').save.busy, true);
    assert.deepEqual([flow('after', 'another writer').repo, flow('after', 'another writer').path], ['acme-fixture/handbook', 'guides']);
    assert.deepEqual([flow('after', 'save refused').repo, flow('after', 'save refused').path], ['acme-fixture/handbook', 'guides']);
    assert.ok(flow('after', 'save refused').toasts.includes(msg('en', 'settings.git.saveError')));
    assert.deepEqual(flow('after', 'retried').stored, {
      ...STORED,
      repo: 'acme-fixture/handbook',
      path: 'guides',
      branch: 'release',
    });
    assert.ok(flow('after', 'retried').toasts.includes(msg('en', 'settings.git.repoSaved')));

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's GitTab (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient, the settings query and mutations; the settings PATCH answered by interception through the real body validator and main's stored-shape rules; a fictional site; not the signed-in dashboard, production, the server, a repository, an import or a deployment`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} before/after sheets and ${recordings.length} recordings; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    // Windows may hold the recording open for a moment after the browser closes.
    await rm(harness, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
