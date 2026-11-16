// Isolated component fixture of Settings → Import → Ghost: main's ImportTab
// (before) and this branch's (after) with the real design system, EN/AR
// catalogs and the Ghost import mutation, for a fictional site and a fictional
// Ghost export. FileReader is replaced in the page by one the script holds,
// fails or slows down; every API request is answered by interception on the
// fixture origin. Not the signed-in dashboard and not production. No server
// starts and nothing is imported anywhere.
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
/** A message by its id as the code names it (`settings.import.ghost.invalidJson`). */
const msg = (locale, id, values = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const origin = 'http://import.fixture.test';
/** The main commit this branch starts from (#773); evidence.json records it as `base`. */
const BASE = 'ab86db55000e512f8f59bba67f4f2433bbbd51fb';
const GHOST_POST = 'POST /api/app/projects/site-1/settings/import/ghost';
const GHOST_URL = 'https://journal.example.com';
/** A fictional Ghost export: one published post. */
const EXPORT = {
  db: [
    {
      meta: { exported_on: 1_763_280_000_000, version: '5.101.0' },
      data: {
        posts: [{ id: '1', title: 'Welcome to the Handbook', slug: 'welcome', html: '<p>Hello.</p>', status: 'published', type: 'post' }],
      },
    },
  ],
};
const SUMMARY = { imported: 1, updated: 0, skipped: 0, warnings: [] };

let harness;
try {
  harness = await mkdtemp(resolve(app, '.ghost-import-capture-'));
  // Main's tab and its Ghost hook as they are on the base (the hook is gone from this branch).
  await mkdir(resolve(harness, 'before'), { recursive: true });
  await writeFile(
    resolve(harness, 'before/import-tab.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/import-tab.tsx`)
      .replace("from './import-errors'", "from '@/components/settings/import-errors'")
      .replace("from './section'", "from '@/components/settings/section'")
      .replace("from '@/hooks/api'", "from './hooks'"),
  );
  const mainMutations = git('show', `${BASE}:apps/app/src/hooks/api/mutations.ts`);
  const mainGhostHook = /\/\*\* One-way import of a Ghost JSON export[\s\S]*?\n};\n/.exec(mainMutations)?.[0];
  assert.ok(mainGhostHook, "main's useImportFromGhost");
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    `export { type ContentImportSummary, useImportFromGitbook, useImportFromMintlify } from '@/hooks/api';
import { mutateData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
${mainGhostHook}`,
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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ImportTab as After } from '@/components/settings/import-tab';
import { ImportTab as Before } from './before/import-tab';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
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
   * A FileReader the script controls, installed before the app loads. Each
   * read really reads the file, then waits: for `__reader.settle(kind)` while
   * `delay` is 0, otherwise for `delay` ms. `failNext` makes the next read
   * fail. The counts say how many reads started and how many the app aborted.
   */
  const installReader = () => {
    const Real = window.FileReader;
    const reader = { delay: 0, failNext: false, started: 0, aborted: 0, held: [] };
    window.__reader = reader;
    reader.settle = (kind) => reader.held.shift()?.(kind);
    window.FileReader = class ControlledReader {
      onload = null;
      onerror = null;
      onabort = null;
      result = null;
      readyState = 0;
      readAsText(file) {
        this.readyState = 1;
        reader.started += 1;
        const real = new Real();
        real.onload = () => {
          const deliver = (kind = reader.failNext ? 'error' : 'load') => {
            if (this.readyState !== 1) return;
            reader.failNext = false;
            this.readyState = 2;
            if (kind === 'load') this.result = real.result;
            (kind === 'load' ? this.onload : this.onerror)?.(new ProgressEvent(kind));
          };
          if (reader.delay) setTimeout(deliver, reader.delay);
          else reader.held.push(deliver);
        };
        real.readAsText(file);
      }
      abort() {
        if (this.readyState !== 1) return;
        this.readyState = 2;
        reader.aborted += 1;
        this.onabort?.(new ProgressEvent('abort'));
      }
    };
  };

  /** Opens the fixture. The Ghost POST is held for `server.delay` ms, then answered with `server.answers.shift()` or a success. */
  async function open(context, { locale, version }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { delay: 0, answers: [] };
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(installReader);
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === GHOST_POST) {
        requests.push({ call, body: request.postDataJSON() });
        await wait(server.delay);
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

  const chip = (page, label) => page.locator('button[aria-pressed]', { hasText: label });
  const importButton = (page) => page.locator('button.ms-auto');
  /** Ghost chosen, its URL typed and the fictional export picked. */
  const readyGhost = async (page) => {
    await chip(page, 'Ghost').click();
    await page.locator('#import-ghost-url').fill(GHOST_URL);
    await page.locator('#import-ghost-file').setInputFiles({
      name: 'journal.ghost.2025-11-16.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(EXPORT)),
    });
  };
  /** Finishes the held read, once the real read under it has finished. */
  const settleRead = async (page, kind) => {
    await page.waitForFunction(() => window.__reader.held.length > 0);
    await page.evaluate((value) => window.__reader.settle(value), kind);
  };
  /** What a reviewer should see: the panel, the Import button (label, busy, disabled, focus), the inputs, toasts and reads. */
  const state = async (page) =>
    page.evaluate(() => {
      const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      const run = document.querySelector('button.ms-auto');
      const [label, running] = run?.querySelectorAll(':scope > span > span') ?? [];
      const busy = run?.getAttribute('aria-busy') === 'true';
      return {
        dir: document.documentElement.dir,
        panel: document.querySelector('#import-ghost-url') ? 'ghost' : document.querySelector('#import-repo') ? 'repo' : 'result',
        result: text(document.querySelector('.min-h-\\[220px\\] p.font-medium')),
        importButton: run && {
          shows: text(busy ? running : label),
          busy,
          disabled: run.disabled,
          ariaDisabled: run.getAttribute('aria-disabled') === 'true',
          focused: document.activeElement === run,
        },
        ghostUrl: document.querySelector('#import-ghost-url')?.value ?? null,
        file: document.querySelector('#import-ghost-file')?.files?.[0]?.name ?? null,
        focusLost: document.activeElement === document.body,
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
        reads: { started: window.__reader.started, abortedByApp: window.__reader.aborted },
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });

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
          seenBy[key] = { ...seen, requests };
          return seen;
        };
        const after = (version) => version === 'after';
        for (const version of ['before', 'after']) {
          // Ready, then Import pressed with Enter while the read is held.
          {
            const context = await newContext();
            const { page, requests, errors } = await open(context, { locale, version });
            await readyGhost(page);
            const ready = await shoot(`${version}-ready`, page, requests, errors);
            assert.equal(ready.importButton.shows, msg(locale, 'settings.import.run'));
            await importButton(page).focus();
            await page.keyboard.press('Enter');
            const reading = await shoot(`${version}-reading`, page, requests, errors);
            assert.equal(reading.reads.started, 1);
            // Main shows nothing while it reads, and Import stays pressable; here it is busy and keeps focus.
            assert.equal(reading.importButton.busy, after(version));
            assert.equal(reading.importButton.ariaDisabled, after(version));
            assert.equal(reading.importButton.disabled, false);
            assert.equal(reading.importButton.focused, true);
            assert.equal(reading.importButton.shows, msg(locale, after(version) ? 'settings.import.running' : 'settings.import.run'));
            await context.close();
          }
          // The read fails: main calls the file invalid JSON; here the import failed, and the file and URL stay.
          {
            const context = await newContext();
            const { page, requests, errors } = await open(context, { locale, version });
            await readyGhost(page);
            await importButton(page).click();
            await settleRead(page, 'error');
            await page.locator('[data-sonner-toast]').first().waitFor();
            const failed = await shoot(`${version}-readFailed`, page, requests, errors);
            assert.deepEqual(failed.toasts, [msg(locale, after(version) ? 'settings.import.error' : 'settings.import.ghost.invalidJson')]);
            assert.equal(failed.ghostUrl, GHOST_URL);
            assert.equal(failed.file, 'journal.ghost.2025-11-16.json');
            assert.equal(failed.importButton.busy, false);
            assert.deepEqual(requests, []);
            await context.close();
          }
          // Mintlify chosen while the read is held, then the read finishes: main still sends the import and its
          // result replaces the Mintlify panel; here the read is retired and nothing is sent.
          {
            const context = await newContext();
            const { page, requests, errors } = await open(context, { locale, version });
            await readyGhost(page);
            await importButton(page).click();
            await chip(page, 'Mintlify').click();
            await settleRead(page, 'load');
            if (!after(version)) await page.locator('[data-sonner-toast]').first().waitFor();
            const switched = await shoot(`${version}-switched`, page, requests, errors);
            if (after(version)) {
              assert.equal(switched.panel, 'repo');
              assert.deepEqual(switched.toasts, []);
              assert.deepEqual(requests, []);
              assert.deepEqual(switched.reads, { started: 1, abortedByApp: 1 });
            } else {
              assert.equal(switched.panel, 'result');
              assert.deepEqual(switched.toasts, [msg(locale, 'settings.import.success')]);
              assert.equal(requests.length, 1);
            }
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
          ['ready', 'Ghost ready: URL and export chosen (unchanged)'],
          ['reading', 'Import pressed with Enter, the file read held: busy only after'],
          ['readFailed', 'The read fails: "invalid JSON" before, "Import failed" after; file and URL kept'],
          ['switched', 'Mintlify chosen during the read, then the read finishes: before sends and replaces the panel'],
        ]
          .map(
            ([key, label]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b></div><div>${panel(locale, `before-${key}`)}</div><div>${panel(locale, `after-${key}`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Import → Ghost · ${width}px${scale < 1 ? ' (shown at 50%)' : ''} · fictional site and export, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', ...seenByLocale });
    }

    // A slow read that fails → retry; a slow read pressed twice → the server refuses (409, an import already
    // running) → retry with the same file and URL → imported.
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
    await page.evaluate(() => {
      window.__reader.delay = 1500;
    });
    server.delay = 900;
    await pause();
    await readyGhost(page);
    await pause();
    await note('Ghost ready: URL and export chosen');
    await page.evaluate(() => {
      window.__reader.failNext = true;
    });
    await importButton(page).click();
    await pause(400);
    await note('reading (slow): busy');
    await pause(1600);
    await note('read failed: "Import failed", file and URL kept');
    server.answers.push({
      status: 409,
      body: { error: { code: 'import:in_progress', message: 'An import is already running for this project.' } },
    });
    await importButton(page).dblclick();
    await pause(400);
    await note('pressed twice, reading (slow): one read');
    await pause(2600);
    await note('refused (409): explained once, file and URL kept');
    await pause(1500);
    await importButton(page).click();
    await pause(400);
    await note('retried: reading (slow)');
    await pause(2900);
    await note('imported: the result');
    await pause(1200);

    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    const sent = { call: GHOST_POST, body: { ...EXPORT, __nibleafImport: { ghostUrl: GHOST_URL } } };
    assert.deepEqual(requests, [sent, sent]);
    assert.equal(at('reading (slow)').importButton.busy, true);
    assert.deepEqual(at('read failed').toasts, [msg(locale, 'settings.import.error')]);
    assert.equal(at('read failed').file, 'journal.ghost.2025-11-16.json');
    assert.equal(at('pressed twice').reads.started, 2);
    assert.ok(at('refused').toasts.includes(msg(locale, 'settings.import.inProgress')));
    assert.equal(at('refused').toasts.filter((toast) => toast === msg(locale, 'settings.import.inProgress')).length, 1);
    assert.equal(at('refused').ghostUrl, GHOST_URL);
    assert.equal(at('imported').panel, 'result');
    assert.equal(at('imported').reads.started, 3);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's ImportTab (${BASE}) and this branch's with the real design system, EN/AR catalogs and the Ghost import mutation; a controlled FileReader; a fictional site and Ghost export; every request answered by interception; not the signed-in dashboard, production, the server's importer or a real Ghost export`,
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
