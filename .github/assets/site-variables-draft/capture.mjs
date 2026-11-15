// Isolated component fixture of Site configuration → Variables: the real
// section (before: the main-branch component; after: features/site-variables)
// with the real design system, EN/AR catalogs, project query and config
// mutation, given a fictional site with fictional public variables. The
// project GET (from an in-page store) and the config PATCH (arrays replace,
// as the API merges) are answered by interception on the fixture origin. Not
// the signed-in dashboard and not production. No server starts.
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
const beforeSource = git('show', `${baseline}:apps/app/src/components/project-settings/variables-section.tsx`).replace(
  "from './shared'",
  "from '@/components/project-settings/shared'",
);
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://variables.fixture.test';
/** The fictional site's saved, public variables. */
const savedVariables = [
  { key: 'product', value: 'Handbook' },
  { key: 'version', value: '4.2' },
  { key: 'support_email', value: 'help@handbook.example' },
  { key: 'tagline_ar', value: 'دليلك إلى المنصة' },
];

const lock = await acquireDevstackLock('site variables draft captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.variables-capture-'));
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-variables";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { VariablesSettings } from '@/features/site-variables/components/variables-settings';
import { useProject } from '@/hooks/api';
import { VariablesSection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
document.documentElement.classList.add('light');
const Section = params.get('phase') === 'before' ? BeforeSection : VariablesSettings;
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
    const server = { variables: savedVariables.map((pair) => ({ ...pair })), saveDelay: 0 };
    const project = () => ({ id: 'site-1', name: 'Handbook', slug: 'handbook', config: { theme: { preset: 'nib' }, variables: server.variables } });
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
        server.variables = body.config.variables;
        return json(route, { data: project() });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}`);
    await keyFields(page, locale).first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const keyFields = (page, locale) => page.getByRole('textbox', { name: catalogs[locale].settings_variables_keylabel, exact: true });
  const valueFields = (page, locale) => page.locator(`input[aria-label="${catalogs[locale].settings_variables_valuelabel}"]`);
  /** What a reviewer should see: the rows, their direction, focus, toasts, and whether the save bar shows. */
  const state = async (page, locale) => ({
    dir: await page.evaluate(() => document.documentElement.dir),
    rows: await Promise.all(
      (await keyFields(page, locale).all()).map(async (key, index) => [
        await key.inputValue(),
        await valueFields(page, locale).nth(index).inputValue(),
      ]),
    ),
    keyDir: await keyFields(page, locale).evaluateAll((inputs) => [...new Set(inputs.map((input) => input.dir))]),
    valueDir: await valueFields(page, locale).evaluateAll((inputs) => [...new Set(inputs.map((input) => input.dir))]),
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
        .locator('[data-slot="save-region"] [role="status"]')
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
    // Four before/after pairs: the saved variables as they open, light theme.
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
          assert.equal(seen[phase].overflow, false);
          assert.deepEqual(errors, []);
          assert.deepEqual(seen[phase].keyDir, ['ltr']);
          assert.deepEqual(seen[phase].valueDir, ['auto']);
          assert.deepEqual(
            seen[phase].rows,
            savedVariables.map(({ key, value }) => [key, value]),
          );
          shots[phase] = await page.screenshot({ fullPage: true, animations: 'disabled' });
          await context.close();
        }
        const file = `pristine-${locale}-${width}.png`;
        const sheet = await browser.newContext({ viewport: { width: width * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
        const sheetPage = await sheet.newPage();
        const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
        await sheetPage.setContent(
          `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Variables section · ${locale.toUpperCase()} · ${width}px · light</div>
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

    // The new form, keyboard only: Add → edit → remove → Undo → Save and the refetch.
    const locale = 'en';
    const width = 1440;
    const file = `keyboard-flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 820 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 820 } },
    });
    const { page, errors, requests, server } = await open(context, { phase: 'after', locale });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page, locale)) });
    const typeSlowly = (text) => page.keyboard.type(text, { delay: 60 });
    await pause();
    await note('opened: the saved variables, no save bar');

    // Tab from the last Remove reaches Add (the panel's footer).
    await page.locator(`[aria-label="${catalogs[locale].settings_variables_remove}"]`).last().focus();
    await page.keyboard.press('Tab');
    await note('Tab: focus on Add variable');
    await page.keyboard.press('Enter');
    await pause(300);
    await note('Enter on Add: a blank row, focus in its name');
    await typeSlowly('docs_url');
    await page.keyboard.press('Tab');
    await typeSlowly('https://handbook.example/docs');
    await pause(300);
    await note('typed a name and a value: unsaved, nothing sent');

    // Shift+Tab back to the second row's Remove ("Remove variable version").
    await keyFields(page, locale).nth(2).focus();
    await page.keyboard.press('Shift+Tab');
    await note('Shift+Tab: focus on Remove for "version"');
    await page.keyboard.press('Enter');
    await pause(400);
    await note('Enter on Remove: the row is gone, focus on the next row’s Remove, Undo offered');

    // Sonner's hotkey moves focus to the toasts; Tab (past the toast itself) reaches Undo.
    await page.keyboard.press('Alt+KeyT');
    let tabs = 0;
    while (tabs < 4 && (await page.evaluate(() => document.activeElement?.textContent?.trim())) !== catalogs[locale].settings_theme_undo) {
      await page.keyboard.press('Tab');
      tabs += 1;
    }
    await note(`Alt+T, Tab ×${tabs}: focus on the toast’s Undo`);
    assert.equal(steps.at(-1).focused, catalogs[locale].settings_theme_undo);
    await page.keyboard.press('Enter');
    await pause(400);
    await note('Enter on Undo: the row is back in place, the new row kept');

    server.saveDelay = 900;
    await keyFields(page, locale).first().focus();
    await page.keyboard.press('Control+s');
    await pause(300);
    await note('Ctrl+S: saving');
    await pause(1600);
    await note('saved and refetched: the rows the server holds, no save bar');

    assert.deepEqual(errors, []);
    const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
    assert.equal(patches.length, 1);
    assert.deepEqual(patches[0].body, { config: { variables: [...savedVariables, { key: 'docs_url', value: 'https://handbook.example/docs' }] } });
    assert.ok(requests.filter(({ call }) => call.startsWith('GET')).length >= 2, 'the save is followed by a refetch');
    assert.equal(steps[0].saveBar, false);
    assert.equal(steps[3].saveBar, true);
    assert.equal(steps[5].rows.length, 4);
    assert.deepEqual(steps[7].rows, [...savedVariables.map(({ key, value }) => [key, value]), ['docs_url', 'https://handbook.example/docs']]);
    assert.equal(steps.at(-1).saveBar, false);
    assert.deepEqual(steps.at(-1).rows, steps[7].rows);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real Variables section (before: main; after: this branch) with the real design system, EN/AR catalogs, project query and config mutation, in an editor-canvas frame; fictional site with fictional public variables; project GET and config PATCH (arrays replace, like the API merge) answered by interception; not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/components/project-settings/variables-section.tsx'],
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} paired captures and ${recordings.length} recording; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
