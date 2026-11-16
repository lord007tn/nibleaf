// Isolated component fixture of Settings → Git → Pipeline (Import → Build →
// Live): main's inline GitPipeline (before) and this branch's
// features/site-git component (after) with the real design system, EN/AR
// catalogs and deployments queries, for a fictional site. Every API request is
// answered by interception on the fixture origin. Not the signed-in dashboard
// and not production. No server starts, and no repository is imported, built
// or deployed anywhere.
//
// Run it while holding the repository's heavy-step lock; it takes no lock itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
/** A message by its id as the code names it (`settings.git.pipeline.notLive`). */
const msg = (locale, id, values = {}) =>
  catalogs[locale][id.replaceAll('.', '_').toLowerCase()].replace(/\{(\w+)\}/g, (_, name) => String(values[name]));
const origin = 'http://git-pipeline.fixture.test';
const TIMEZONE = 'Africa/Lagos';
/** The main commit this branch starts from (#769); evidence.json records it as `base`. */
const BASE = '602f2498e32f26f6686a63a24fca2ddfd45e25da';
const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');

const EARLY = '2026-11-15T09:00:00.000Z';
const LATE = '2026-11-15T10:30:00.000Z';
const deployment = (version, status, pagesCount = 12) => ({
  id: `deployment-${version}`,
  version,
  status,
  pagesCount,
  commitMessage: null,
  error: null,
  createdAt: '2026-11-15T08:00:00.000Z',
  completedAt: status === 'READY' || status === 'FAILED' ? '2026-11-15T08:01:00.000Z' : null,
});
/**
 * Each state: the Git metadata the tab hands the card, the attempts list
 * (newest 50) and the live-only list the fixture answers with, and whether an
 * import is in progress.
 */
const STATES = {
  empty: { label: 'No attempts, never imported', git: {}, attempts: [], live: [] },
  overflow: {
    label: '50 newer failed attempts; v3 live only in the live-only list; manual import',
    git: { lastImportedAt: LATE },
    attempts: Array.from({ length: 50 }, (_, index) => deployment(60 - index, 'FAILED')),
    live: [deployment(3, 'READY', 9)],
  },
  building: {
    label: 'v8 building over live v7; push sync tied with the manual import (sync shown)',
    git: { lastImportedAt: EARLY, lastSyncAt: EARLY, lastSyncStatus: 'ok' },
    attempts: [deployment(8, 'BUILDING', 0), deployment(7, 'READY', 6)],
    live: [deployment(7, 'READY', 6)],
  },
  syncFailed: {
    label: 'Failed push sync with its error (plain text); v9 failed over live v8',
    git: { lastImportedAt: EARLY, lastSyncAt: LATE, lastSyncStatus: 'failed', lastSyncError: 'fatal: <b>docs/</b> not found on branch main' },
    attempts: [deployment(9, 'FAILED'), deployment(8, 'READY', 14)],
    live: [deployment(8, 'READY', 14)],
  },
  importing: {
    label: 'Import now pressed: busy with its loading text; v2 built and live',
    git: { lastImportedAt: EARLY },
    attempts: [deployment(2, 'READY', 4)],
    live: [deployment(2, 'READY', 4)],
    importing: true,
  },
};

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-pipeline-capture-'));
  // Main's card is a private function of its git-tab.tsx: read the base file and export it.
  await mkdir(resolve(harness, 'before'), { recursive: true });
  await writeFile(
    resolve(harness, 'before/git-tab.tsx'),
    `${git('show', `${BASE}:apps/app/src/components/settings/git-tab.tsx`)
      .replace("from './git-workflow'", "from '@/components/settings/git-workflow'")
      .replace("from './section'", "from '@/components/settings/section'")}\nexport { GitPipeline };\n`,
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
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GitPipeline as After } from '@/features/site-git/components/git-pipeline';
import { GitPipeline as Before } from './before/git-tab';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const fixture = JSON.parse(params.get('fixture') ?? '{}');
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, refetchInterval: false } } });
const Pipeline = params.get('version') === 'before' ? Before : After;
(window as unknown as { imports: number }).imports = 0;
function Card() {
  const [importing] = useState(Boolean(fixture.importing));
  return (
    <Pipeline
      projectId="site-1"
      git={fixture.git ?? {}}
      importing={importing}
      onImport={() => {
        (window as unknown as { imports: number }).imports += 1;
      }}
    />
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
      <main className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Card /></main>
    </DirectionProvider>
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
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };

  /** Opens one state. The fixture answers the two deployments reads; any other API call fails the run. */
  async function open(context, { locale, version, state }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const fixture = STATES[state];
    const json = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}${url.search}`;
      if (url.pathname.startsWith('/api/')) requests.push(call);
      if (call === 'GET /api/app/projects/site-1/deployments') return json(route, fixture.attempts);
      if (call === 'GET /api/app/projects/site-1/deployments?status=READY') return json(route, fixture.live);
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    const search = new URLSearchParams({ locale, version, fixture: JSON.stringify({ git: fixture.git, importing: fixture.importing ?? false }) });
    await page.goto(`${origin}/?${search}`);
    await page.locator('section h2').waitFor({ timeout: 15_000 });
    // Both deployments reads answered and rendered.
    await page.waitForFunction(() => document.querySelectorAll('section .relative.flex.gap-3').length === 3);
    await page.waitForTimeout(200);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests };
  }

  /** What a reviewer should see: each step's label, detail, marker classes and action, the link, and the layout. */
  const readback = (page) =>
    page.evaluate(() => {
      const text = (node) => node?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      return {
        dir: document.documentElement.dir,
        steps: [...document.querySelectorAll('section .relative.flex.gap-3')].map((step) => {
          const [label, detail] = [...step.querySelectorAll('.min-w-0.leading-snug > div')].map(text);
          const action = step.querySelector('[data-slot="button"]');
          return {
            label,
            detail,
            marker: step.querySelector('.z-10')?.className,
            action: action
              ? {
                  name: text(action),
                  busy: action.getAttribute('aria-busy') === 'true',
                  disabled: action.disabled === true,
                  href: action.getAttribute('href'),
                }
              : null,
          };
        }),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });

  const captures = [];
  const keyboard = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const width of [390, 1440]) {
      const shots = {};
      const seen = {};
      for (const locale of ['en', 'ar']) {
        for (const state of Object.keys(STATES)) {
          for (const version of ['before', 'after']) {
            const context = await browser.newContext({
              viewport: { width, height: 900 },
              reducedMotion: 'reduce',
              colorScheme: 'light',
              timezoneId: TIMEZONE,
            });
            const { page, errors, requests } = await open(context, { locale, version, state });
            const read = await readback(page);
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            assert.deepEqual(errors, []);
            assert.deepEqual(requests.sort(), ['GET /api/app/projects/site-1/deployments', 'GET /api/app/projects/site-1/deployments?status=READY']);
            const shot = await page.locator('section').screenshot({ animations: 'disabled' });
            shots[`${locale}-${state}-${version}`] = shot;
            seen[`${locale}-${state}-${version}`] = { ...read, requests, screenshotSha256: sha(shot) };
            await context.close();
          }
          const before = seen[`${locale}-${state}-before`];
          const after = seen[`${locale}-${state}-after`];
          assert.deepEqual(after.steps, before.steps, `${locale}/${state} reads differently at ${width}px`);
          assert.equal(after.screenshotSha256, before.screenshotSha256, `${locale}/${state} is not pixel-identical at ${width}px`);
        }
      }
      // Spot checks against the catalogs, so identical-but-wrong would still fail.
      assert.equal(seen['en-empty-after'].steps[1].detail, msg('en', 'settings.git.pipeline.noBuilds'));
      assert.equal(seen['en-overflow-after'].steps[2].detail, msg('en', 'settings.git.pipeline.built', { version: 3, pages: 9 }));
      assert.equal(seen['en-overflow-after'].steps[2].action.href, '/sites/site-1');
      assert.equal(seen['ar-building-after'].steps[1].detail, msg('ar', 'settings.git.pipeline.building', { version: 8 }));
      assert.ok(seen['en-syncFailed-after'].steps[0].detail.endsWith(' — fatal: <b>docs/</b> not found on branch main'));
      assert.equal(seen['en-importing-after'].steps[0].action.busy, true);

      const file = `pipeline-${width}.png`;
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
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${label}</b> · identical: ${seen[`${locale}-${state}-before`].screenshotSha256 === seen[`${locale}-${state}-after`].screenshotSha256 ? 'yes' : 'NO'}</div><div>${panel(`${locale}-${state}-before`)}</div><div>${panel(`${locale}-${state}-after`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Pipeline · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional site, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', timezone: TIMEZONE, states: seen });
    }

    // Import now from the keyboard, on both versions: one call, focus kept, no navigation and no request.
    for (const version of ['before', 'after']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', timezoneId: TIMEZONE });
      const { page, errors, requests } = await open(context, { locale: 'en', version, state: 'overflow' });
      const before = page.url();
      const reads = requests.length;
      const button = page.getByRole('button', { name: msg('en', 'settings.git.import.now') });
      await button.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
      const result = {
        version,
        imports: await page.evaluate(() => window.imports),
        focusedOnImport: await button.evaluate((node) => document.activeElement === node),
        sameUrl: page.url() === before,
        requestsAfterPress: requests.length - reads,
        pageErrors: errors,
      };
      assert.deepEqual(result, { version, imports: 1, focusedOnImport: true, sameUrl: true, requestsAfterPress: 0, pageErrors: [] });
      keyboard.push(result);
      await context.close();
    }

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's inline GitPipeline (${BASE}) and this branch's features/site-git GitPipeline with the real design system, EN/AR catalogs and deployments queries; fictional site; every request answered by interception; not the signed-in dashboard, production, a repository, the worker or a deployment`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      keyboard,
    });
  });
  console.log(
    `${captures.length} before/after sheets, ${Object.keys(STATES).length} states × EN/AR, pixel-identical; keyboard Import checked on both`,
  );
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
