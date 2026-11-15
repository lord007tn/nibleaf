// Isolated component fixture of Site configuration → Redirects: the real
// section (before: the main-branch component; after: features/site-redirects)
// with the real design system, EN/AR catalogs, project query and config
// mutation, given a fictional site with fictional public redirect rules. The
// project GET (from an in-page store) and the config PATCH (arrays replace,
// as the API merges) are answered by interception on the fixture origin. Not
// the signed-in dashboard, not production, and no redirect is ever followed.
// No server starts.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
const beforeSource = git('show', `${baseline}:apps/app/src/components/project-settings/redirects-section.tsx`).replace(
  "from './shared'",
  "from '@/components/project-settings/shared'",
);
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://redirects.fixture.test';
/** The fictional site's saved rules: one the editor generated when a page moved, three the writer typed. */
const savedRedirects = [
  { from: '/guides/install', to: '/get-started/install', generated: true },
  { from: '/legacy', to: 'https://archive.example.com/docs?ref=handbook#top', generated: false },
  { from: '/دليل', to: '/ar/guide?lang=ar', generated: false },
  { from: '/api/v1', to: '/reference/api#v1', generated: false },
];

const lock = await acquireDevstackLock('site redirects draft captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.redirects-capture-'));
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-redirects";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { RedirectsSettings } from '@/features/site-redirects/components/redirects-settings';
import { useProject } from '@/hooks/api';
import { RedirectsSection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
document.documentElement.classList.add('light');
const Section = params.get('phase') === 'before' ? BeforeSection : RedirectsSettings;
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });

/** The editor's Configuration canvas: the site from the project query, then the section, keyed by site as the host does. */
function Canvas() {
  const { data: project } = useProject('site-1');
  return project ? <Section key={project.id} project={project} /> : null;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <main className="mx-auto w-full max-w-4xl px-5 pt-7 pb-32 text-foreground sm:px-8"><Canvas /></main>
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
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));

  /** Opens the fixture over an in-page store of the site. `server.saveDelay` holds the PATCH. */
  async function open(context, { phase, locale }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { redirects: savedRedirects.map((rule) => ({ ...rule })), saveDelay: 0 };
    const project = () => ({ id: 'site-1', name: 'Handbook', slug: 'handbook', config: { theme: { preset: 'nib' }, redirects: server.redirects } });
    const json = (route, data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === 'GET /api/app/projects/site-1') {
        requests.push({ call });
        return json(route, { data: project() });
      }
      if (call === 'PATCH /api/app/projects/site-1') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        await wait(server.saveDelay);
        // The API's merge: an array replaces the stored one.
        server.redirects = body.config.redirects;
        return json(route, { data: project() });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}`);
    await fromFields(page, locale).first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const fromFields = (page, locale) => page.locator(`input[aria-label="${catalogs[locale].settings_redirects_fromlabel}"]`);
  const toFields = (page, locale) => page.locator(`input[aria-label="${catalogs[locale].settings_redirects_tolabel}"]`);
  /** What a reviewer should see: the rows, their direction, problems, focus, toasts, and whether the save bar shows. */
  const state = async (page, locale) => ({
    dir: await page.evaluate(() => document.documentElement.dir),
    rows: await Promise.all(
      (await fromFields(page, locale).all()).map(async (from, index) => [
        await from.inputValue(),
        await toFields(page, locale).nth(index).inputValue(),
      ]),
    ),
    fieldDir: [
      ...new Set([
        ...(await fromFields(page, locale).evaluateAll((inputs) => inputs.map((input) => input.dir))),
        ...(await toFields(page, locale).evaluateAll((inputs) => inputs.map((input) => input.dir))),
      ]),
    ],
    invalid: await page
      .locator('[aria-invalid="true"]')
      .evaluateAll((fields) => fields.map((field) => `${field.getAttribute('aria-label')}: ${field.value}`)),
    problems: await page
      .locator('[data-slot="callout"][data-tone="danger"] li')
      .allInnerTexts()
      .catch(() => []),
    focused: await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return null;
      const named = (active.getAttribute('aria-labelledby') ?? '')
        .split(' ')
        .map((id) => {
          const element = document.getElementById(id);
          return element === active ? active.getAttribute('aria-label') : element?.value || element?.textContent?.trim();
        })
        .filter(Boolean)
        .join(' ');
      return named || active.getAttribute('aria-label') || active.textContent?.trim() || active.tagName;
    }),
    toasts: await page.locator('[data-sonner-toast]').allInnerTexts(),
    saveBar: await page
      .locator('[data-slot="save-region"]')
      .isVisible()
      .catch(() => false),
    status: (
      await page
        .locator('[role="status"]')
        .allInnerTexts()
        .catch(() => [])
    )
      .join(' ')
      .trim(),
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  });

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    // Four before/after pairs: the saved rules as they open, light theme.
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390]) {
        const shots = {};
        const seen = {};
        for (const phase of ['before', 'after']) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
          const { page, errors, requests } = await open(context, { phase, locale });
          await page.mouse.move(0, 0);
          seen[phase] = { ...(await state(page, locale)), requests, pageErrors: errors };
          assert.equal(seen[phase].dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.deepEqual(errors, []);
          assert.deepEqual(seen[phase].fieldDir, ['ltr']);
          assert.deepEqual(
            seen[phase].rows,
            savedRedirects.map(({ from, to }) => [from, to]),
          );
          if (phase === 'after') assert.equal(seen[phase].overflow, false);
          shots[phase] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          await context.close();
        }
        const file = `pristine-${locale}-${width}.png`;
        const sheet = await browser.newContext({ viewport: { width: width * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
        const sheetPage = await sheet.newPage();
        const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
        await sheetPage.setContent(
          `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Redirects section · ${locale.toUpperCase()} · ${width}px · light</div>
<div style="display:flex;gap:16px;align-items:flex-start">${['before', 'after']
            .map(
              (phase) =>
                `<figure style="margin:0"><figcaption style="margin-bottom:4px">${phase === 'before' ? 'before (main)' : 'after (this branch)'}</figcaption><img src="${img(shots[phase])}" width="${width}"></figure>`,
            )
            .join('')}</div></body>`,
        );
        await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
        await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true });
        await sheet.close();
        captures.push({ file, locale, width, theme: 'light', before: seen.before, after: seen.after });
      }

    // The new form: an invalid rule is refused and fixed, a row removed and restored, then Save and the refetch.
    const locale = 'en';
    const width = 1440;
    const file = `invalid-fix-undo-save-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 900 } },
    });
    const { page, errors, requests } = await open(context, { phase: 'after', locale });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page, locale)) });
    const typeSlowly = (text) => page.keyboard.type(text, { delay: 60 });
    await pause();
    await note('opened: the saved rules, no save bar');

    await page.getByRole('button', { name: catalogs[locale].settings_redirects_add }).click();
    await pause(300);
    await typeSlowly('/blog');
    await page.keyboard.press('Tab');
    await typeSlowly('//news.example.com');
    await pause(300);
    await note('Add, a source, Tab, a protocol-relative destination: the row was left, so its problem shows; nothing sent');

    await page.keyboard.press('Control+s');
    await pause(500);
    await note('Ctrl+S: refused, focus on the destination, the problem named, nothing sent');

    await page.keyboard.press('Control+a');
    await typeSlowly('/news');
    await pause(400);
    await note('corrected: the problem goes as it is fixed');

    await page.locator(`[aria-label="${catalogs[locale].settings_redirects_remove}"]`).nth(1).click();
    await pause(400);
    await note('Remove /legacy: gone from the draft, Undo offered');
    await page.getByRole('button', { name: catalogs[locale].settings_theme_undo }).click();
    await pause(400);
    await note('Undo: /legacy is back in place, the new rule kept');

    await page.keyboard.press('Control+s');
    await pause(1200);
    await note('Ctrl+S: saved and refetched, the rules the server holds, no save bar');

    assert.deepEqual(errors, []);
    const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
    assert.equal(patches.length, 1, 'only the corrected draft was sent');
    assert.deepEqual(patches[0].body, { config: { redirects: [...savedRedirects, { from: '/blog', to: '/news', generated: false }] } });
    assert.ok(requests.filter(({ call }) => call.startsWith('GET')).length >= 2, 'the save is followed by a refetch');
    assert.equal(steps[0].saveBar, false);
    assert.equal(steps[2].focused, catalogs[locale].settings_redirects_tolabel);
    assert.ok(steps[2].problems.length > 0);
    assert.ok(steps[2].status.includes(catalogs[locale].forms_fixhighlighted));
    assert.deepEqual(steps[3].problems, []);
    assert.equal(steps[4].rows.length, 4);
    assert.deepEqual(steps[5].rows, [...savedRedirects.map(({ from, to }) => [from, to]), ['/blog', '/news']]);
    assert.equal(steps.at(-1).saveBar, false);
    assert.ok(steps.at(-1).status.includes(catalogs[locale].common_saved));
    assert.deepEqual(steps.at(-1).rows, steps[5].rows);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real Redirects section (before: main; after: this branch) with the real design system, EN/AR catalogs, project query and config mutation, in an editor-canvas frame; fictional site with fictional public rules; project GET and config PATCH (arrays replace, like the API merge) answered by interception; not the signed-in dashboard or production; no redirect is followed',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/components/project-settings/redirects-section.tsx'],
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} paired captures and ${recordings.length} recording; no page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
