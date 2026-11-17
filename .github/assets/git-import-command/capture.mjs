// Isolated component fixture of Settings → Git → Legacy import settings → Pipeline → "Import now": main's GitTab
// (before) and this branch's (after) with the real design system, EN/AR catalogs, the app's own QueryClient (wrapped
// to record which keys are invalidated), the settings and deployments queries and the import mutation, for two
// fictional sites. Every API request is answered by interception on the fixture origin; the import POST is held
// until the script answers it. Not the signed-in dashboard and not production. No server starts, and nothing is
// imported, built or deployed anywhere.
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
/** A message by its id as the code names it (`settings.git.import.now`). */
const msg = (locale, id, values = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const origin = 'http://git-import.fixture.test';
/** The main commit this branch starts from (#783); evidence.json records it as `base`. */
const BASE = '1ba227f87c2a4e44aa4df08c0560aad0866df851';
const SITES = {
  'site-a': {
    connected: true,
    provider: 'github',
    repo: 'acme-fixture/handbook',
    branch: 'main',
    path: 'docs',
    lastImportedAt: '2026-11-15T09:00:00.000Z',
  },
  'site-b': {
    connected: true,
    provider: 'github',
    repo: 'acme-fixture/guides',
    branch: 'main',
    path: 'docs',
    lastImportedAt: '2026-11-14T16:30:00.000Z',
  },
};
const SUMMARY = { imported: 3, updated: 1, skipped: 0, warnings: [] };

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-import-capture-'));
  await mkdir(resolve(harness, 'before'), { recursive: true });
  // Main's Git import as it is on the base (this branch removed it) and its webhook rotation (removed later); every
  // other hook is today's.
  const mainMutations = git('show', `${BASE}:apps/app/src/hooks/api/mutations.ts`);
  const mainImport =
    /\/\*\* Pull Markdown pages from the configured public Git provider[\s\S]*?\nexport const useImportFromGit = [\s\S]*?\n};\n/.exec(
      mainMutations,
    )?.[0];
  assert.ok(mainImport, "main's useImportFromGit");
  const mainRotate =
    /\/\*\* Generate or rotate the push-to-deploy webhook secret[\s\S]*?\nexport const useRotateGitWebhookSecret = [\s\S]*?\n};\n/.exec(
      mainMutations,
    )?.[0];
  assert.ok(mainRotate, "main's useRotateGitWebhookSecret");
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    `export * from '@/hooks/api';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
${mainImport}${mainRotate}`,
  );
  // Main's Pipeline card too: this branch changes it, and main's GitTab imports it from features/site-git.
  await writeFile(
    resolve(harness, 'before/git-pipeline.tsx'),
    git('show', `${BASE}:apps/app/src/features/site-git/components/git-pipeline.tsx`).replace(
      "from '../model/git-pipeline'",
      "from '@/features/site-git/model/git-pipeline'",
    ),
  );
  await writeFile(
    resolve(harness, 'before/git-tab.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/git-tab.tsx`)
      .replace("from '@/hooks/api'", "from './hooks'")
      .replace("from '@/features/site-git/components/git-pipeline'", "from './git-pipeline'")
      .replace("from './git-workflow'", "from '@/components/settings/git-workflow'")
      .replace("from './section'", "from '@/components/settings/section'"),
  );
  // The per-site connection above the legacy import is out of scope: rendered as nothing on both sides.
  await writeFile(resolve(harness, 'git-workflow-stub.tsx'), 'export const GitWorkflow = () => null;\n');
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-git";\n@source "../src/components";\n@source "../../../packages/design-system/src";\n',
  );
  // The settings page keys the tab by site (`git-${projectId}`): `setSite` is leaving for another site.
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClientProvider } from '@tanstack/react-query';
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
const fixture = window as unknown as { invalidated: unknown[]; setSite?: (site: string) => void };
fixture.invalidated = [];
const invalidate = client.invalidateQueries.bind(client);
client.invalidateQueries = ((filters, options) => {
  fixture.invalidated.push(filters?.queryKey ?? null);
  return invalidate(filters, options);
}) as typeof client.invalidateQueries;
const Tab = params.get('version') === 'before' ? Before : After;
function Page() {
  const [site, setSite] = useState('site-a');
  fixture.setSite = setSite;
  return <Tab key={\`git-\${site}\`} projectId={site} />;
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
   * Opens the fixture on site A. The settings GET returns the site's stored
   * legacy connection. An import POST is held while `server.hold` (until
   * `server.release()`), then refused with 500 if `server.fail` (once), else
   * answered with a fixed summary. Reads of branches, languages, deployments
   * and the per-site connection get fixed answers; any other API call fails
   * the run.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const held = [];
    const server = { hold: false, fail: false, release: () => held.shift()?.(), held: () => held.length };
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}`;
      const site = /^\/api\/app\/projects\/(site-[ab])\//.exec(url.pathname)?.[1];
      if (site && call === `GET /api/app/projects/${site}/settings`) {
        return json(route, { data: { plan: 'free', notifications: {}, integrations: {}, git: { ...SITES[site], webhookSecret: 'f1c7f1c7' } } });
      }
      if (site && call === `POST /api/app/projects/${site}/settings/git/import`) {
        requests.push({ call, body: request.postData() ?? null });
        if (server.hold) await new Promise((done) => held.push(done));
        if (server.fail) {
          server.fail = false;
          return json(route, { error: { message: 'Could not import from Git.' } }, 500);
        }
        return json(route, { data: SUMMARY });
      }
      if (site && call === `GET /api/app/projects/${site}/branches`) return json(route, { data: [{ id: 'branch-draft', name: 'draft' }] });
      if (site && call === `GET /api/app/projects/${site}/languages`) return json(route, { data: [{ id: 'lang-en', code: 'en', label: 'English' }] });
      if (site && call === `GET /api/app/projects/${site}/git`) return json(route, { data: null });
      if (site && url.pathname === `/api/app/projects/${site}/deployments`) return json(route, { data: [] });
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await importButton(page, locale).waitFor({ timeout: 15_000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  // The Pipeline card itself (the legacy section around it has the same heading inside it).
  const pipeline = (page, locale) =>
    page.locator('section:not([data-testid="git-legacy"])', { has: page.getByRole('heading', { name: msg(locale, 'settings.git.pipeline.title') }) });
  // Its first button is Import (View site is a link).
  const importButton = (page, locale) => pipeline(page, locale).locator('button').first();
  const settle = (page, ms = 300) => page.waitForTimeout(ms);
  /** Waits for at least `count` held import POSTs to arrive (main may send more: the counts are asserted per state). */
  const arrived = async (page, server, count = 1) => {
    for (let tries = 0; server.held() < count && tries < 100; tries += 1) await page.waitForTimeout(50);
    assert.ok(server.held() >= count);
  };
  const setSite = async (page, site) => {
    await page.evaluate((next) => window.setSite(next), site);
    await settle(page);
  };
  /** What a reviewer should see: the site, the Import button (text, busy, disabled, focus), toasts and refreshed keys. */
  // Chromium moves focus off a button that became :disabled at its next rendering update: read after two frames.
  const readback = (page) =>
    page.evaluate(async () => {
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const section = [...document.querySelectorAll('section:not([data-testid="git-legacy"])')].find(
        (node) => node.querySelector('h2') && node.querySelector('button[data-slot="button"]'),
      );
      const button = section?.querySelector('button');
      return {
        dir: document.documentElement.dir,
        repository: document.querySelector('[data-testid="git-legacy"] .font-mono')?.textContent?.trim() ?? null,
        importButton: {
          text: button?.textContent?.replace(/\s+/g, ' ').trim(),
          busy: button?.getAttribute('aria-busy') === 'true',
          disabled: Boolean(button?.disabled),
          ariaDisabled: button?.getAttribute('aria-disabled') === 'true',
          focused: Boolean(button) && document.activeElement === button,
        },
        focused: document.activeElement?.tagName.toLowerCase() ?? null,
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
        invalidated: window.invalidated,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });

  /** Each state, run on both versions: what the person did before the screenshot. */
  const STATES = {
    ready: { label: 'Connected legacy import (site A), nothing pressed', run: async () => undefined },
    double: {
      label: 'Import pressed twice in one task, request held',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await importButton(page, locale).focus();
        await importButton(page, locale).evaluate((button) => {
          button.click();
          button.click();
        });
        await arrived(page, server);
        await settle(page);
      },
    },
    enter: {
      label: 'Import pressed with Enter (keyboard), request held, then Enter again',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await importButton(page, locale).focus();
        await page.keyboard.press('Enter');
        await arrived(page, server);
        await settle(page);
        await page.keyboard.press('Enter');
        await settle(page);
      },
    },
    remount: {
      label: 'Site A importing (held), leave for site B and back to A, press Import again',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await importButton(page, locale).click();
        await arrived(page, server);
        await setSite(page, 'site-b');
        await setSite(page, 'site-a');
        // The Import button as site A shows again, before it is pressed.
        server.reopened = (await readback(page)).importButton;
        await importButton(page, locale)
          .click({ force: true, trial: false })
          .catch(() => undefined);
        await settle(page);
      },
    },
    staleSuccess: {
      label: 'Site A importing (held), leave for site B, then A succeeds',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await importButton(page, locale).click();
        await arrived(page, server);
        await setSite(page, 'site-b');
        server.hold = false;
        server.release();
        await settle(page, 600);
      },
    },
    staleFailure: {
      label: 'Site A importing (held), leave for site B, then A fails (500)',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        server.fail = true;
        await importButton(page, locale).click();
        await arrived(page, server);
        await setSite(page, 'site-b');
        server.hold = false;
        server.release();
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
            const read = await readback(page);
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            assert.deepEqual(errors, []);
            await page.mouse.move(0, 0);
            await pipeline(page, locale).scrollIntoViewIfNeeded();
            shots[`${locale}-${state}-${version}`] = await pipeline(page, locale).screenshot({ animations: 'disabled' });
            seen[`${locale}-${state}-${version}`] = { ...read, ...(server.reopened ? { reopened: server.reopened } : {}), requests: [...requests] };
            // Answer anything still held so the context closes cleanly.
            server.hold = false;
            while (server.held()) server.release();
            await context.close();
          }
        }
        // The behaviour each sheet shows, asserted so a wrong capture fails the run.
        const at = (state, version) => seen[`${locale}-${state}-${version}`];
        const siteA = [
          ['workspace', 'settings', 'site-a'],
          ['pages', 'site-a'],
        ];
        const result = msg(locale, 'settings.git.import.result', { imported: 3, updated: 1 });
        for (const version of ['before', 'after']) {
          assert.equal(at('ready', version).importButton.busy, false);
          assert.equal(at('double', version).importButton.busy, true);
          assert.equal(at('enter', version).importButton.busy, true);
          // Leaving: the success refreshes site A only, and nothing is reported into site B's panel.
          assert.deepEqual(at('staleSuccess', version).invalidated, siteA);
          assert.equal(at('staleSuccess', version).repository, 'acme-fixture/guides');
          assert.ok(!at('staleSuccess', version).toasts.includes(result));
          assert.deepEqual(at('staleFailure', version).invalidated, []);
          assert.ok(!at('staleFailure', version).toasts.includes(msg(locale, 'settings.git.import.error')));
          for (const request of at('double', version).requests)
            assert.deepEqual(request, { call: 'POST /api/app/projects/site-a/settings/git/import', body: null });
        }
        // Main: A → B → A shows A idle while its import runs, and a second POST goes out.
        assert.equal(at('remount', 'before').reopened.busy, false);
        assert.equal(at('remount', 'before').requests.length, 2);
        // Here: still busy, one POST.
        assert.equal(at('remount', 'after').reopened.busy, true);
        assert.equal(at('remount', 'after').importButton.busy, true);
        assert.equal(at('remount', 'after').requests.length, 1);
        assert.equal(at('double', 'after').requests.length, 1);
        assert.equal(at('enter', 'after').requests.length, 1);
        // Main: the busy button is :disabled and Chromium moves focus to the page; here it keeps keyboard focus.
        for (const state of ['double', 'enter']) {
          assert.equal(at(state, 'before').importButton.focused, false, `${locale}/${state}/before at ${width}px kept focus`);
          assert.equal(at(state, 'after').importButton.focused, true);
          assert.equal(at(state, 'after').importButton.ariaDisabled, true);
        }
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(Math.min(width, 768) * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const caption = (key) => {
        const { requests, importButton: button, toasts, invalidated, reopened } = seen[key];
        const keys = invalidated.map((item) => JSON.stringify(item)).join(' ') || 'none';
        return `${reopened ? `busy on return to A ${reopened.busy} · ` : ''}POSTs ${requests.length} · busy ${button.busy} · focus on Import ${button.focused} · refreshed ${keys} · toasts ${toasts.length ? toasts.join(' | ') : 'none'}`;
      };
      const panel = (key) =>
        `<img src="data:image/png;base64,${shots[key].toString('base64')}" width="${shown}" style="display:block;border:1px solid #bbb"><div style="font-size:11px;margin-top:2px;max-width:${shown}px">${caption(key)}</div>`;
      const rows = (locale) =>
        Object.entries(STATES)
          .map(
            ([state, { label }]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(`${locale}-${state}-before`)}</div><div>${panel(`${locale}-${state}-after`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Legacy import → Pipeline · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional sites, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (main ${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', states: seen });
    }

    // Held import → refused (500) → retry → held → leave for B and back → succeeds, on both versions.
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
      await pipeline(page, locale).scrollIntoViewIfNeeded();
      const pause = (ms = 700) => page.waitForTimeout(ms);
      const steps = [];
      const note = async (step) => steps.push({ step, ...(await readback(page)), requestsSoFar: requests.length });
      await pause();
      server.hold = true;
      server.fail = true;
      await importButton(page, locale).click();
      await arrived(page, server);
      await pause();
      await note('import held: busy');
      server.release();
      await pause(1200);
      await note('import refused (500)');
      await importButton(page, locale).click();
      await arrived(page, server);
      await pause();
      await note('retry held: busy');
      await setSite(page, 'site-b');
      await pause();
      await note('left for site B while A imports');
      await setSite(page, 'site-a');
      await pause();
      await note('back on site A while it imports');
      await importButton(page, locale)
        .click({ timeout: 2000 })
        .catch(() => undefined);
      await pause();
      await note('Import pressed again on site A');
      server.hold = false;
      while (server.held()) server.release();
      await pause(1200);
      await note('answered: succeeded');
      await importButton(page, locale).click();
      await pause(1200);
      await note('imported again from the same panel');
      await pause(1200);
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, version, locale, width, theme: 'light', requests, pageErrors: errors, steps });
    }
    const flow = (version, prefix) => recordings.find((item) => item.version === version).steps.find(({ step }) => step.startsWith(prefix));
    for (const version of ['before', 'after']) {
      assert.equal(flow(version, 'import held').importButton.busy, true);
      assert.ok(flow(version, 'import refused').toasts.includes(msg('en', 'settings.git.import.error')));
      assert.deepEqual(flow(version, 'import refused').invalidated, []);
      assert.ok(flow(version, 'imported again').toasts.includes(msg('en', 'settings.git.import.result', { imported: 3, updated: 1 })));
    }
    // Main: back on A while it imports shows Import idle and sends a second POST; here it stays busy and sends none.
    assert.equal(flow('before', 'back on site A').importButton.busy, false);
    assert.equal(flow('before', 'Import pressed again').requestsSoFar, 3);
    assert.equal(flow('after', 'back on site A').importButton.busy, true);
    assert.equal(flow('after', 'Import pressed again').requestsSoFar, 2);

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's GitTab (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient (invalidations recorded), the settings and deployments queries and the import mutation; the import POST held and answered by interception (a fixed summary, or a 500); fictional sites; not the signed-in dashboard, production, the server, a repository, an import or a deployment`,
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
