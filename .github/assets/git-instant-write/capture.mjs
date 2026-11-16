// Isolated component fixture of Settings → Git's instant writes (auto publish,
// Disconnect, and the new connection switching the legacy import off): main's
// GitTab at the pinned base (before) and this branch's (after), with the real
// design system, EN/AR catalogs, settings query and mutations, for a fictional
// site. Every API request is answered by interception on the fixture origin;
// the settings PATCH goes through the real body validator, answered as the
// route answers it (422 when refused, 500 when it throws), and is stored as the
// server stores it (`git` replaced wholesale, bookkeeping carried over, the
// webhook secret kept apart). Not the signed-in dashboard and not production.
// No server starts, and no repository is imported, built or deployed anywhere.
//
// The "before" side is built entirely from the pinned base: its GitTab and the
// whole `features/site-git` slice it imports are read with `git show`, so a
// later refactor of today's files cannot change or break it. Only the shared
// app modules (`@/hooks/api`, the design system, the query client) are today's.
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
/** A message by its id as the code names it (`settings.git.saveError`). */
const msg = (locale, id, values = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const origin = 'http://git-instant-write.fixture.test';
/** The main commit this branch starts from (#779); evidence.json records it as `base`. */
const BASE = 'a716947c9b4879b413251b1725f84417d07410f6';
const SITE = 'site-1';
const SETTINGS = `/api/app/projects/${SITE}/settings`;
const SECRET = 'f1c7f1c7';
const SERVER_MANAGED = ['lastImportedAt', 'lastSyncAt', 'lastSyncStatus', 'lastSyncError'];
const BOOKKEEPING = { lastImportedAt: '2026-11-15T09:00:00.000Z', lastSyncAt: '2026-11-15T10:30:00.000Z', lastSyncStatus: 'ok' };
/** Legacy connections with only their own address stored: the shapes main's instant writes broke (#780). */
const CONNECTIONS = {
  github: { connected: true, provider: 'github', repo: 'acme-fixture/docs', branch: 'main', path: 'docs', autoPublish: false },
  gitlab: {
    connected: true,
    provider: 'gitlab',
    repo: 'acme-fixture/handbook',
    instanceUrl: 'https://gitlab.acme-fixture.test',
    branch: 'release',
    path: '',
    autoPublish: true,
  },
  git: { connected: true, provider: 'git', cloneUrl: 'https://git.acme-fixture.test/acme/docs.git', branch: 'main', path: 'guides' },
};

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-instant-write-capture-'));
  // Main's GitTab and its `features/site-git` slice, as they are on the base.
  const slice = git('ls-tree', '-r', '--name-only', BASE, 'apps/app/src/features/site-git')
    .split('\n')
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file));
  for (const file of slice) {
    const target = resolve(harness, 'before/site-git', file.replace('apps/app/src/features/site-git/', ''));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, git('show', `${BASE}:${file}`));
  }
  // Main's Git import as it is on the base (removed since); every other hook is today's.
  const mainImport =
    /\/\*\* Pull Markdown pages from the configured public Git provider[\s\S]*?\nexport const useImportFromGit = [\s\S]*?\n};\n/.exec(
      git('show', `${BASE}:apps/app/src/hooks/api/mutations.ts`),
    )?.[0];
  assert.ok(mainImport, "main's useImportFromGit");
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    `export * from '@/hooks/api';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
${mainImport}`,
  );
  await writeFile(
    resolve(harness, 'before/git-tab.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/git-tab.tsx`)
      .replaceAll("from '@/features/site-git/", "from './site-git/")
      .replace("from '@/hooks/api'", "from './hooks'")
      .replace("from './git-workflow'", "from '@/components/settings/git-workflow'")
      .replace("from './section'", "from '@/components/settings/section'"),
  );
  // The per-site connection above the legacy import renders as nothing; the script calls the hand-off
  // it makes when a new connection is saved (`onConnected`).
  await writeFile(
    resolve(harness, 'git-workflow-stub.tsx'),
    'export const GitWorkflow = ({ onConnected }: { onConnected?: () => void }) => {\n  (window as unknown as { connectNew?: () => void }).connectNew = onConnected;\n  return null;\n};\n',
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
import { GitTab as After } from '@/components/settings/git-tab';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { GitTab as Before } from './before/git-tab';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = createQueryClient();
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
  const settingsBody = (stored) => ({ data: { plan: 'free', notifications: {}, integrations: {}, git: { ...stored, webhookSecret: SECRET } } });

  /**
   * Opens the fixture over `stored`. The settings GET returns it with the
   * webhook secret (as to an admin). A PATCH runs the real body validator: 500
   * when it throws, 422 when it refuses, else stored as the server stores it.
   * Branches, languages, deployments and the per-site connection get fixed
   * answers; any other API call fails the run.
   */
  async function open(context, { locale, version, stored }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { git: { ...stored, ...BOOKKEEPING }, secret: SECRET };
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}${url.search}`;
      if (call === `GET ${SETTINGS}`) {
        requests.push({ call });
        return json(route, settingsBody(server.git));
      }
      if (call === `PATCH ${SETTINGS}`) {
        const body = request.postDataJSON();
        const entry = { call, body };
        requests.push(entry);
        let parsed;
        try {
          parsed = updateWorkspaceSettingsBody.safeParse(body);
        } catch (error) {
          entry.status = 500;
          entry.validator = `threw ${error.name}: ${error.message}`;
          return json(route, { error: { code: 'http:internal', message: 'Internal server error.' } }, 500);
        }
        if (!parsed.success) {
          entry.status = 422;
          entry.validator = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
          return json(route, { error: { code: 'validation:failed', message: 'Validation failed.' } }, 422);
        }
        entry.status = 200;
        entry.parsedEqualsSent = JSON.stringify(parsed.data) === JSON.stringify(body);
        const next = { ...parsed.data.git };
        for (const key of SERVER_MANAGED) if (next[key] === undefined && server.git[key] !== undefined) next[key] = server.git[key];
        server.git = JSON.parse(JSON.stringify(next));
        return json(route, settingsBody(server.git));
      }
      if (call === `GET /api/app/projects/${SITE}/branches`) return json(route, { data: [] });
      if (call === `GET /api/app/projects/${SITE}/languages`) return json(route, { data: [{ id: 'lang-en', code: 'en', label: 'English' }] });
      if (call === `GET /api/app/projects/${SITE}/git`) return json(route, { data: null });
      if (url.pathname === `/api/app/projects/${SITE}/deployments`) return json(route, { data: [] });
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('[data-testid="git-legacy"]').waitFor({ timeout: 15_000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const settle = (page, ms = 700) => page.waitForTimeout(ms);
  const autoPublish = (page) => page.locator('[role="switch"]');
  const disconnect = async (page, locale) => {
    await page
      .locator('form')
      .getByRole('button', { name: msg(locale, 'settings.git.disconnect'), exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: msg(locale, 'settings.git.disconnect'), exact: true })
      .click();
  };
  /** What a reviewer should see: the switch, whether the legacy import still shows, toasts, and layout. */
  const readback = (page) =>
    page.evaluate(() => ({
      dir: document.documentElement.dir,
      autoPublish: document.querySelector('[role="switch"]')?.getAttribute('aria-checked') ?? null,
      legacyShown: Boolean(document.querySelector('[data-testid="git-legacy"]')),
      toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }));

  /**
   * Each state, run on both versions over its stored connection, with the one
   * change it should store and the toast it should show.
   */
  const STATES = {
    toggle: {
      label: 'GitHub, no stored clone URL: auto publish switched on',
      stored: CONNECTIONS.github,
      change: { autoPublish: true },
      toast: 'settings.git.webhook.autoPublishSaved',
      target: 'switch',
      run: ({ page }) => autoPublish(page).click(),
    },
    disconnect: {
      label: 'GitHub, no stored clone URL: Disconnect, confirmed',
      stored: CONNECTIONS.github,
      change: { connected: false },
      toast: 'settings.git.disconnectedToast',
      target: 'main',
      run: ({ page, locale }) => disconnect(page, locale),
    },
    switchOff: {
      label: 'Self-hosted GitLab, blank content path: the new connection switches the legacy import off',
      stored: CONNECTIONS.gitlab,
      change: { connected: false },
      toast: 'settings.git.legacy.switched',
      target: 'main',
      run: ({ page }) => page.evaluate(() => window.connectNew?.()),
    },
    gitUrl: {
      label: 'Git URL, no stored repository, auto publish never set: switched on',
      stored: CONNECTIONS.git,
      change: { autoPublish: true },
      toast: 'settings.git.webhook.autoPublishSaved',
      target: 'switch',
      run: ({ page }) => autoPublish(page).click(),
    },
  };
  /** What a panel shows: the auto-publish step for a toggle, else the top of the Git tab (where the legacy import was). */
  const shoot = async (page, target, width) => {
    if (target === 'switch') {
      const step = page.locator('li:has([role="switch"])');
      await step.scrollIntoViewIfNeeded();
      return step.screenshot({ animations: 'disabled' });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = await page.locator('main').boundingBox();
    return page.screenshot({
      animations: 'disabled',
      clip: { x: box.x, y: box.y, width: box.width, height: Math.max(160, Math.min(box.height, width < 800 ? 640 : 360)) },
    });
  };

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const width of [390, 1440]) {
      const shots = {};
      const seen = {};
      for (const locale of ['en', 'ar']) {
        for (const [state, { stored, run, target }] of Object.entries(STATES)) {
          for (const version of ['before', 'after']) {
            const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce', colorScheme: 'light' });
            const { page, errors, requests, server } = await open(context, { locale, version, stored });
            await run({ page, locale });
            await settle(page);
            const read = await readback(page);
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            assert.deepEqual(errors, []);
            await page.mouse.move(0, 0);
            shots[`${locale}-${state}-${version}`] = await shoot(page, target, width);
            seen[`${locale}-${state}-${version}`] = {
              ...read,
              patches: requests.filter(({ call }) => call.startsWith('PATCH')),
              stored: server.git,
              secretKept: server.secret === SECRET,
            };
            await context.close();
          }
          // The behaviour each panel shows, asserted so a wrong capture fails the run.
          const { stored: connection, change, toast } = STATES[state];
          const before = seen[`${locale}-${state}-before`];
          const after = seen[`${locale}-${state}-after`];
          assert.equal(before.patches.length, 1);
          assert.equal(before.patches[0].status, connection.provider === 'git' ? 422 : 500);
          assert.deepEqual(before.stored, { ...connection, ...BOOKKEEPING });
          assert.ok(before.toasts.includes(msg(locale, 'settings.git.saveError')));
          assert.equal(after.patches.length, 1);
          assert.equal(after.patches[0].status, 200);
          assert.equal(after.patches[0].parsedEqualsSent, true);
          assert.deepEqual(after.patches[0].body, { git: { ...connection, ...change } });
          assert.ok(!JSON.stringify(after.patches[0].body).includes(SECRET));
          assert.deepEqual(after.stored, { ...connection, ...change, ...BOOKKEEPING });
          assert.ok(after.secretKept);
          assert.ok(after.toasts.includes(msg(locale, toast)));
          assert.ok(!after.toasts.includes(msg(locale, 'settings.git.saveError')));
          if ('autoPublish' in change) {
            assert.equal(before.autoPublish, String(connection.autoPublish === true));
            assert.equal(after.autoPublish, 'true');
          } else {
            assert.equal(before.legacyShown, true);
            assert.equal(after.legacyShown, false);
          }
        }
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(Math.min(width, 768) * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const escapeHtml = (text) => String(text).replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[char]);
      const caption = (key) => {
        const { patches, toasts } = seen[key];
        return `<div style="margin-top:4px;font:12px ui-monospace,monospace">PATCH → ${patches.map(({ status }) => status).join(', ')} · toast: ${escapeHtml(toasts.join(' / ') || '—')}</div>`;
      };
      const panel = (key) =>
        `<img src="data:image/png;base64,${shots[key].toString('base64')}" width="${shown}" style="display:block;border:1px solid #bbb;background:#fff">${caption(key)}`;
      const rows = (locale) =>
        Object.entries(STATES)
          .map(
            ([state, { label }]) =>
              `<div style="grid-column:1/3;margin-top:12px"><b>${locale.toUpperCase()} · ${escapeHtml(label)}</b></div><div>${panel(`${locale}-${state}-before`)}</div><div>${panel(`${locale}-${state}-after`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git, instant writes · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional site, every request intercepted · PATCH answered as the route answers (real validator: 422 refused, 500 thrown)</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px;align-items:start"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', states: seen });
    }

    // This branch, EN, 1440: auto publish on → off → Disconnect (confirmed), each write intercepted and read back.
    {
      const locale = 'en';
      const width = 1440;
      const file = `flow-after-${locale}-${width}.webm`;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
        recordVideo: { dir: harness, size: { width, height: 900 } },
      });
      const { page, errors, requests, server } = await open(context, { locale, version: 'after', stored: CONNECTIONS.github });
      const pause = (ms = 900) => page.waitForTimeout(ms);
      const steps = [];
      const note = async (step) =>
        steps.push({
          step,
          ...(await readback(page)),
          stored: server.git,
          lastPatch: requests.filter(({ call }) => call.startsWith('PATCH')).at(-1) ?? null,
        });
      await page.locator('li:has([role="switch"])').scrollIntoViewIfNeeded();
      await pause();
      await note('ready: GitHub legacy import, no stored clone URL, auto publish off');
      await autoPublish(page).click();
      await pause(1400);
      await note('auto publish switched on');
      await autoPublish(page).click();
      await pause(1400);
      await note('auto publish switched off');
      await page
        .locator('form')
        .getByRole('button', { name: msg(locale, 'settings.git.disconnect'), exact: true })
        .scrollIntoViewIfNeeded();
      await page
        .locator('form')
        .getByRole('button', { name: msg(locale, 'settings.git.disconnect'), exact: true })
        .click();
      await pause();
      await note('Disconnect: confirmation open');
      await page
        .getByRole('dialog')
        .getByRole('button', { name: msg(locale, 'settings.git.disconnect'), exact: true })
        .click();
      await pause(1400);
      await page.evaluate(() => window.scrollTo(0, 0));
      await note('disconnected');
      await pause(1200);
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, version: 'after', locale, width, theme: 'light', requests, pageErrors: errors, steps });
      const step = (prefix) => steps.find(({ step: name }) => name.startsWith(prefix));
      assert.equal(step('auto publish switched on').autoPublish, 'true');
      assert.deepEqual(step('auto publish switched on').stored, { ...CONNECTIONS.github, autoPublish: true, ...BOOKKEEPING });
      assert.equal(step('auto publish switched off').autoPublish, 'false');
      assert.deepEqual(step('auto publish switched off').stored, { ...CONNECTIONS.github, ...BOOKKEEPING });
      assert.deepEqual(step('disconnected').stored, { ...CONNECTIONS.github, connected: false, ...BOOKKEEPING });
      assert.equal(step('disconnected').legacyShown, false);
      const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
      assert.deepEqual(
        patches.map(({ status }) => status),
        [200, 200, 200],
      );
      assert.ok(patches.every(({ parsedEqualsSent }) => parsedEqualsSent));
    }

    assert.equal(attempted.length, 0);
    // The webhook secret (a fixture value) is the server's: in no body, readback or step.
    assert.ok(!JSON.stringify({ captures, recordings }).includes(SECRET));
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's GitTab and features/site-git at ${BASE} and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient, the settings query and mutations; the settings PATCH answered by interception through the real body validator (422 refused, 500 thrown, as the route answers) and the server's stored-shape rules; a fictional site; not the signed-in dashboard, production, the server, a repository, an import, a deployment or a webhook`,
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
