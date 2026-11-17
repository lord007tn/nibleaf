// Isolated component fixture of Settings → Import → Mintlify / GitBook: main's
// ImportTab with its two hooks (before) and this branch's (after), with the real
// design system, EN/AR catalogs and import mutations, for a fictional site and
// fictional repositories. Every API request is answered by interception on the
// fixture origin, held until the script answers it. Not the signed-in
// dashboard and not production. No server starts and nothing is imported anywhere.
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
/** A message by its id as the code names it (`settings.import.inProgress`). */
const msg = (locale, id, values = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const origin = 'http://import.fixture.test';
/** The main commit this branch starts from (#775), pinned; evidence.json records it as `base`. */
const BASE = 'c7a98c48f78f8a6a25efa7711e2f6a351d3f4f8b';
const POST = {
  mintlify: 'POST /api/app/projects/site-1/settings/import/mintlify',
  gitbook: 'POST /api/app/projects/site-1/settings/import/gitbook',
};
/** Fictional repositories, typed as people paste them. */
const MINTLIFY_REPO = 'https://github.com/acme-fixture/handbook.git';
const GITBOOK_REPO = 'acme-fixture/guides';
const SUMMARY = { imported: 4, updated: 1, skipped: 0, warnings: [] };
const IN_PROGRESS = { status: 409, body: { error: { code: 'import:in_progress', message: 'An import is already running for this project.' } } };

let harness;
try {
  harness = await mkdtemp(resolve(app, '.repository-import-capture-'));
  // Main's tab and its two repository hooks as they are on the base (the hooks are gone from this branch).
  await mkdir(resolve(harness, 'before'), { recursive: true });
  await writeFile(
    resolve(harness, 'before/import-tab.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/import-tab.tsx`)
      .replace("from './import-errors'", "from '@/components/settings/import-errors'")
      .replace("from './section'", "from '@/components/settings/section'")
      .replace("from '@/hooks/api'", "from './hooks'"),
  );
  const mainMutations = git('show', `${BASE}:apps/app/src/hooks/api/mutations.ts`);
  const mainHooks =
    /\/\*\* One-way import of a public Mintlify GitHub docs repo[\s\S]*?\n};\n\n\/\*\* One-way import of a public GitBook[\s\S]*?\n};\n/.exec(
      mainMutations,
    )?.[0];
  assert.ok(mainHooks, "main's useImportFromMintlify and useImportFromGitbook");
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    `export type { ContentImportSummary } from '@/hooks/api';
import type { GitbookImportBody, MintlifyImportBody } from '@nibleaf/validators';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
${mainHooks}`,
  );
  // The tab only uses the router to open the editor or Git settings; the fixture has no router.
  await writeFile(
    resolve(harness, 'router-stub.ts'),
    "export * from '@tanstack/react-router';\nexport const useNavigate = () => () => Promise.resolve();\n",
  );
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-import";\n@source "../src/components";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ImportTab as After } from '@/components/settings/import-tab';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { ImportTab as Before } from './before/import-tab';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = createQueryClient();
const invalidate = client.invalidateQueries.bind(client);
window.__refreshed = [];
client.invalidateQueries = (filters, options) => {
  window.__refreshed.push(filters?.queryKey);
  return invalidate(filters, options);
};
const Tab = params.get('version') === 'before' ? Before : After;
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Tab projectId="site-1" /></main>
    </DirectionProvider>
    <Toaster theme="light" />
  </QueryClientProvider>,
);
`,
  );
  const { build } = await fromApp('vite');
  const stub = resolve(harness, 'router-stub.ts');
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
        name: 'router-stub',
        enforce: 'pre',
        resolveId: (source, importer) => (source === '@tanstack/react-router' && importer && resolve(importer) !== stub ? stub : undefined),
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
   * Opens the fixture. An import POST waits `server.delay` ms, or, with `server.hold`, until `server.release()`;
   * then it is answered with `server.answers.shift()` or a success.
   */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const held = [];
    const server = { delay: 0, hold: false, answers: [], release: () => held.shift()?.(), held: () => held.length };
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === POST.mintlify || call === POST.gitbook) {
        requests.push({ call, body: request.postDataJSON() });
        if (server.hold) await new Promise((done) => held.push(done));
        else await wait(server.delay);
        const answer = server.answers.shift();
        return answer ? json(route, answer.body, answer.status) : json(route, { data: SUMMARY });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}`);
    await page.locator('button[aria-pressed]').first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const chip = (page, locale, provider) => page.locator('button[aria-pressed]', { hasText: msg(locale, `settings.import.${provider}.title`) });
  const importButton = (page) => page.locator('button.ms-auto');
  /** A provider chosen and a fictional repository typed (GitBook with a space path). */
  const ready = async (page, locale, provider) => {
    await chip(page, locale, provider).click();
    await page.locator('#import-repo').fill(provider === 'mintlify' ? MINTLIFY_REPO : GITBOOK_REPO);
    if (provider === 'gitbook') await page.locator('#import-gitbook-path').fill('/spaces/guides/');
  };
  /** Waits until `count` import requests have arrived (and checks no more did). */
  const waitForRequests = async (page, requests, count) => {
    for (let tries = 0; requests.length < count && tries < 100; tries += 1) await page.waitForTimeout(50);
    await page.waitForTimeout(200);
    assert.equal(requests.length, count);
  };
  /** What a reviewer should see: the panel, the Import button (label, busy, disabled, focus), the repo field, toasts and refreshes. */
  const state = async (page) =>
    page.evaluate(() => {
      const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      const run = document.querySelector('button.ms-auto');
      const [label, running] = run?.querySelectorAll(':scope > span > span') ?? [];
      const busy = run?.getAttribute('aria-busy') === 'true';
      return {
        dir: document.documentElement.dir,
        panel: document.querySelector('#import-gitbook-path') ? 'gitbook' : document.querySelector('#import-repo') ? 'mintlify' : 'result',
        chip: text(document.querySelector('button[aria-pressed="true"]')),
        result: text(document.querySelector('.min-h-\\[220px\\] p.font-medium')),
        importButton: run && {
          shows: text(busy ? running : label),
          busy,
          disabled: run.disabled,
          ariaDisabled: run.getAttribute('aria-disabled') === 'true',
          focused: document.activeElement === run,
        },
        repo: document.querySelector('#import-repo')?.value ?? null,
        focusLost: document.activeElement === document.body,
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
        refreshed: window.__refreshed,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  const mintlifyBody = { repo: 'acme-fixture/handbook', replaceExisting: false };
  const gitbookBody = { repo: 'acme-fixture/guides', replaceExisting: false, path: 'spaces/guides' };
  const siteRefresh = [['pages', 'site-1'], ['projects', 'site-1'], ['projects']];

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
        const shoot = async (key, page, requests, errors) => {
          await page.waitForTimeout(300);
          const seen = await state(page);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.overflow, false, `${key} overflows at ${width}px`);
          assert.deepEqual(errors, []);
          shots[key] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          seenBy[key] = { ...seen, requests: [...requests] };
          return seen;
        };
        const after = (version) => version === 'after';
        for (const version of ['before', 'after']) {
          // Ready, then Import double-clicked while the request is held.
          {
            const context = await newContext();
            const { page, requests, errors, server } = await open(context, { locale, version });
            server.hold = true;
            await ready(page, locale, 'mintlify');
            const shown = await shoot(`${version}-ready`, page, requests, errors);
            assert.equal(shown.importButton.shows, msg(locale, 'settings.import.run'));
            await importButton(page).focus();
            // Two presses in one task, before React renders the busy button.
            await page.evaluate(() => {
              const button = document.querySelector('button.ms-auto');
              button.click();
              button.click();
            });
            await waitForRequests(page, requests, after(version) ? 1 : 2);
            const pressed = await shoot(`${version}-pressed`, page, requests, errors);
            assert.equal(pressed.importButton.busy, true);
            assert.equal(pressed.importButton.ariaDisabled, true);
            assert.equal(pressed.importButton.focused, true);
            assert.equal(pressed.importButton.shows, msg(locale, 'settings.import.running'));
            assert.deepEqual(
              requests.map(({ body }) => body),
              after(version) ? [mintlifyBody] : [mintlifyBody, mintlifyBody],
            );
            while (server.held()) server.release();
            await context.close();
          }
          // Mintlify running, GitBook chosen and typed, then Mintlify succeeds: both refresh the site; main's
          // result replaces the GitBook form, here the GitBook form stays.
          {
            const context = await newContext();
            const { page, requests, errors, server } = await open(context, { locale, version });
            server.hold = true;
            await ready(page, locale, 'mintlify');
            await importButton(page).click();
            await waitForRequests(page, requests, 1);
            await ready(page, locale, 'gitbook');
            server.release();
            if (after(version)) await page.waitForFunction(() => document.querySelector('button.ms-auto')?.getAttribute('aria-busy') !== 'true');
            else await page.locator('[data-sonner-toast]').first().waitFor();
            const switched = await shoot(`${version}-staleSuccess`, page, requests, errors);
            assert.deepEqual(switched.refreshed, siteRefresh);
            if (after(version)) {
              assert.equal(switched.panel, 'gitbook');
              assert.equal(switched.repo, GITBOOK_REPO);
              assert.deepEqual(switched.toasts, []);
            } else {
              assert.equal(switched.panel, 'result');
              assert.deepEqual(switched.toasts, [msg(locale, 'settings.import.success')]);
            }
            await context.close();
          }
          // GitBook running, Mintlify chosen, then GitBook is refused: main toasts the refusal over the Mintlify form.
          {
            const context = await newContext();
            const { page, requests, errors, server } = await open(context, { locale, version });
            server.hold = true;
            server.answers.push(IN_PROGRESS);
            await ready(page, locale, 'gitbook');
            await importButton(page).click();
            await waitForRequests(page, requests, 1);
            await chip(page, locale, 'mintlify').click();
            server.release();
            if (after(version)) await page.waitForFunction(() => document.querySelector('button.ms-auto')?.getAttribute('aria-busy') !== 'true');
            else await page.locator('[data-sonner-toast]').first().waitFor();
            const stale = await shoot(`${version}-staleError`, page, requests, errors);
            assert.equal(stale.panel, 'mintlify');
            assert.deepEqual(requests, [{ call: POST.gitbook, body: gitbookBody }]);
            assert.deepEqual(stale.toasts, after(version) ? [] : [msg(locale, 'settings.import.inProgress')]);
            assert.deepEqual(stale.refreshed, []);
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
          ['ready', 'Mintlify ready: a fictional repository typed (unchanged)'],
          ['pressed', 'Import pressed twice in one task, request held: two requests before, one after; busy keeps focus'],
          ['staleSuccess', 'Mintlify running, GitBook chosen and typed, then Mintlify succeeds: before replaces the GitBook form'],
          ['staleError', 'GitBook running, Mintlify chosen, then GitBook is refused (409): before toasts over the Mintlify form'],
        ]
          .map(
            ([key, label]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(locale, `before-${key}`)}</div><div>${panel(locale, `after-${key}`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Import → Mintlify / GitBook · ${width}px${scale < 1 ? ' (shown at 50%)' : ''} · fictional site and repositories, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', ...seenByLocale });
    }

    // Mintlify refused (409, an import already running) → retry with the same fields → GitBook chosen while it
    // runs (busy stays, nothing lands in the GitBook form) → GitBook imported.
    const locale = 'en';
    const width = 1440;
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 900 } },
    });
    const { page, errors, requests, server } = await open(context, { locale, version: 'after' });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page)), requestsSoFar: requests.length });
    server.delay = 1500;
    await pause();
    await ready(page, locale, 'mintlify');
    await pause();
    await note('Mintlify ready');
    server.answers.push(IN_PROGRESS);
    await importButton(page).click();
    await pause(400);
    await note('importing (slow): busy');
    await pause(1800);
    await note('refused (409): explained once, fields kept');
    await pause(1200);
    await importButton(page).click();
    await pause(400);
    await note('retried: busy');
    await ready(page, locale, 'gitbook');
    await pause(300);
    await note('GitBook chosen while Mintlify runs: still busy');
    await pause(1500);
    await note('Mintlify finished: nothing replaces the GitBook form');
    await pause(800);
    await importButton(page).click();
    await pause(400);
    await note('GitBook importing: busy');
    await pause(1800);
    await note('GitBook imported: the result');
    await pause(1200);

    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    assert.deepEqual(requests, [
      { call: POST.mintlify, body: mintlifyBody },
      { call: POST.mintlify, body: mintlifyBody },
      { call: POST.gitbook, body: gitbookBody },
    ]);
    assert.equal(at('importing (slow)').importButton.busy, true);
    assert.deepEqual(at('refused').toasts, [msg(locale, 'settings.import.inProgress')]);
    assert.equal(at('refused').repo, MINTLIFY_REPO);
    assert.equal(at('refused').importButton.busy, false);
    assert.equal(at('GitBook chosen').importButton.busy, true);
    assert.equal(at('GitBook chosen').panel, 'gitbook');
    assert.equal(at('Mintlify finished').panel, 'gitbook');
    assert.equal(at('Mintlify finished').importButton.busy, false);
    assert.ok(!at('Mintlify finished').toasts.includes(msg(locale, 'settings.import.success')));
    assert.deepEqual(at('Mintlify finished').refreshed, siteRefresh);
    assert.equal(at('GitBook imported').panel, 'result');
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's ImportTab and its Mintlify/GitBook hooks (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient and the import mutations; a fictional site and repositories; every request answered by interception; not the signed-in dashboard, production, the server's importers or a real repository`,
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
