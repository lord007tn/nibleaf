// Isolated component fixture of Site configuration → Themes: the real section
// (before: the main-branch component; after: features/site-theme) with the real
// design system, EN/AR catalogs, project query, project PATCH, theme import and
// export mutations, given a fictional site. The project GET, the PATCH (merged
// one level deep, as the API does) and the template endpoints (on the shared
// theme functions `actions/themes.ts` uses) are answered by interception on the
// fixture origin. Not the signed-in dashboard, not production. No server starts.
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
const themes = await fromApp('@nibleaf/shared/themes');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
const beforeSource = git('show', `${baseline}:apps/app/src/components/project-settings/theme-section.tsx`).replace(
  "from './shared'",
  "from '@/components/project-settings/shared'",
);
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://theme.fixture.test';
/** The fictional site: an authored Signal theme beside Styling's colour and radius, and other sections. */
const savedConfig = {
  seo: { metaTitle: 'Handbook' },
  typography: { bodyFont: 'Inter' },
  styling: { primaryColor: '#2f4ad0', radius: 'rounded', theme: 'light' },
  theme: {
    version: 1,
    preset: 'signal',
    metadata: { name: 'Handbook', description: 'The Handbook theme' },
    colors: { light: { accent: '#2f4ad0' } },
  },
};
/** A fictional template, as an owner would paste it. */
const pasted = JSON.stringify(
  {
    kind: 'nibleaf-theme',
    version: 1,
    metadata: { name: 'Field notes', description: 'A shared editorial theme' },
    config: { theme: { preset: 'manuscript', layout: { contentWidth: 'focused' } } },
  },
  null,
  2,
);
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const lock = await acquireDevstackLock('site theme draft captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.theme-capture-'));
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-theme";\n@source "../src/components/project-settings";\n@source "../src/components/site";\n@source "../src/lib/forms";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { ThemeSettings } from '@/features/site-theme/components/theme-settings';
import { useProject } from '@/hooks/api';
import { ThemeSection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
document.documentElement.lang = locale;
document.documentElement.classList.add('light');
const Section = params.get('phase') === 'before' ? BeforeSection : ThemeSettings;
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });

/** The editor's Configuration canvas: the site from the project query, then the section, keyed by site as the host does. */
function Canvas() {
  const { data: project } = useProject('site-1');
  return project ? <Section key={project.id} project={project} /> : null;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <main className="mx-auto w-full max-w-4xl px-5 pt-7 pb-32 text-foreground sm:px-8"><Canvas /></main>
      <Toaster theme="light" />
    </ConfirmProvider>
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

  /** Opens the fixture over an in-page store of the site. `server.failNext` refuses the next write (PATCH or apply). */
  async function open(context, { phase, locale }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { config: structuredClone(savedConfig), failNext: false };
    const project = () => ({ id: 'site-1', name: 'Handbook', slug: 'handbook', config: structuredClone(server.config) });
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    const refuse = (route) => {
      server.failNext = false;
      return json(route, { error: { code: 'internal', message: 'The fixture refused this write.' } }, 500);
    };
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
        if (server.failNext) return refuse(route);
        // The API's merge: each object section one level deep.
        for (const [key, value] of Object.entries(body.config)) {
          server.config[key] = isObject(value) ? { ...(isObject(server.config[key]) ? server.config[key] : {}), ...value } : value;
        }
        return json(route, { data: project() });
      }
      if (call === 'GET /api/app/projects/site-1/theme-template') {
        requests.push({ call });
        const template = themes.themeTemplateFromConfig(server.config);
        return json(route, { data: { template, json: themes.canonicalThemeTemplateJson(template) } });
      }
      if (call === 'POST /api/app/projects/site-1/theme-template/import') {
        const body = request.postDataJSON();
        requests.push({ call, body: { mode: body.mode, apply: body.apply } });
        if (body.apply && server.failNext) return refuse(route);
        // actions/themes.ts, for a template that already parses.
        const incoming = {
          ...body.template.config,
          theme: { version: 1, preset: 'harbor', ...body.template.config.theme, metadata: body.template.metadata },
        };
        const current = server.config;
        const next = themes.applyThemeTemplateConfig(
          themes.applyThemeTemplateConfig(current, themes.themeOwnedConfig(current), 'replace'),
          incoming,
          body.mode,
        );
        const changes = themes.previewThemeConfigChanges(current, next);
        if (body.apply) server.config = next;
        return json(route, {
          data: {
            applied: body.apply,
            mode: body.mode,
            changes,
            theme: themes.resolveTheme(themes.themeOwnedConfig(next)),
            template: themes.themeTemplateFromConfig(next),
            publishedChangesPending: body.apply && changes.length > 0,
          },
        });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}`);
    await page.getByText(catalogs[locale].settings_theme_gallery, { exact: true }).first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  /** What a reviewer should see: the active preset, marked colours, focus, dialogs, toasts, the save bar, overflow. */
  const state = (page) =>
    page.evaluate(() => {
      const active = document.activeElement;
      return {
        dir: document.documentElement.dir,
        preset: [...document.querySelectorAll('main button[aria-pressed="true"] strong')].map((node) => node.textContent?.trim()),
        invalid: [...document.querySelectorAll('[aria-invalid="true"]')].map((node) => node.getAttribute('aria-label')),
        focused: active && active !== document.body ? active.getAttribute('aria-label') || active.textContent?.trim() || active.tagName : null,
        dialog: document.querySelector('[role="alertdialog"], [role="dialog"]')?.textContent?.trim() ?? null,
        importResult: document.querySelector('[data-import-result]')?.getAttribute('data-import-result') ?? null,
        undoEnabled: [...document.querySelectorAll('main button')].some((button) => /Undo|تراجع/.test(button.textContent ?? '') && !button.disabled),
        toasts: [...document.querySelectorAll('[data-sonner-toast]:not([data-removed="true"])')].map((toast) => toast.innerText.trim()),
        saveBar: Boolean(document.querySelector('[data-slot="save-region"]')),
        status: [...document.querySelectorAll('[role="status"]')]
          .map((region) => region.textContent?.trim())
          .filter(Boolean)
          .join(' '),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    // Before/after pairs, EN and AR, 1440 and 390, light theme, as the section opens.
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390]) {
        const shots = {};
        const seen = {};
        for (const phase of ['before', 'after']) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
          const { page, errors, requests } = await open(context, { phase, locale });
          await page.mouse.move(0, 0);
          seen[phase] = { ...(await state(page)), requests, pageErrors: errors };
          assert.equal(seen[phase].dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.deepEqual(errors, []);
          if (phase === 'after') {
            assert.equal(seen[phase].overflow, false);
            assert.equal(seen[phase].saveBar, false);
          }
          shots[phase] = await page.screenshot({ fullPage: true, animations: 'disabled', type: 'jpeg', quality: 80 });
          await context.close();
        }
        const file = `open-${locale}-${width}.jpg`;
        const sheet = await browser.newContext({ viewport: { width: width * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
        const sheetPage = await sheet.newPage();
        const img = (buffer) => `data:image/jpeg;base64,${buffer.toString('base64')}`;
        await sheetPage.setContent(
          `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Themes section · UI ${locale.toUpperCase()} · ${width}px · light</div>
<div style="display:flex;gap:16px;align-items:flex-start">${['before', 'after']
            .map(
              (phase) =>
                `<figure style="margin:0"><figcaption style="margin-bottom:4px">${phase === 'before' ? 'before (main)' : 'after (this branch)'}</figcaption><img src="${img(shots[phase])}" width="${width}"></figure>`,
            )
            .join('')}</div></body>`,
        );
        await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
        await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'jpeg', quality: 55 });
        await sheet.close();
        captures.push({ file, locale, width, theme: 'light', before: seen.before, after: seen.after });
      }

    // The new form: preset, Undo, an invalid colour, a refused and a failed save, a save, Discard, then the template exchange.
    const locale = 'en';
    const width = 1280;
    const t = catalogs[locale];
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 800 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 800 } },
    });
    const { page, errors, requests, server } = await open(context, { phase: 'after', locale });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page)) });
    const show = (locator) => locator.scrollIntoViewIfNeeded();
    const presetButton = (id) => page.getByRole('button', { name: new RegExp(t[`settings_theme_preset_${id}_name`]) });
    const colour = (key) => page.getByLabel(t[`settings_theme_color_${key}`], { exact: true });
    await pause();
    await note('opened: the stored Signal theme, no save bar');

    await show(presetButton('manuscript'));
    await presetButton('manuscript').click();
    await pause();
    await note('Manuscript picked: the save bar shows');
    await page.getByRole('button', { name: t.settings_theme_undo }).click();
    await pause();
    await note('Undo: back on Signal, no save bar');

    await presetButton('manuscript').click();
    await show(colour('foreground'));
    await colour('foreground').fill('#eeeeee');
    await page.keyboard.press('Tab');
    await pause();
    await note('a light text colour that fails contrast, left: marked');
    await page.keyboard.press('Control+s');
    await pause(900);
    await note('Ctrl+S refused before any request: "Fix the highlighted fields", focus on the colour');
    await page.getByRole('button', { name: t.settings_theme_undo }).click();
    await pause();
    await note('Undo: the text colour is back, nothing marked');

    server.failNext = true;
    await page.keyboard.press('Control+s');
    await pause(1100);
    await note('Ctrl+S, refused by the server: one error toast, the draft kept, no "Saved"');
    await page.keyboard.press('Control+s');
    await pause(1300);
    await note('Ctrl+S again: saved and refetched, the theme alone sent; no save bar');

    const appearance = page.getByRole('button', { name: t.settings_styling_theme_dark, exact: true }).first();
    await show(appearance);
    await appearance.click();
    await pause();
    await note('appearance switched to dark: the save bar shows');
    await page.getByRole('button', { name: t.forms_discard }).click();
    await pause();
    await note('Discard: back to light, no save bar');

    const box = page.getByLabel(t.settings_theme_importjson, { exact: true });
    await show(box);
    await box.fill(pasted);
    await page.getByRole('button', { name: t.settings_theme_previewimport }).click();
    await pause(1100);
    await note('Preview import: the proposed changes, nothing written');
    server.failNext = true;
    await page.getByRole('button', { name: t.settings_theme_applyimport }).click();
    await pause(1100);
    await note('Apply, refused by the server: the apply error, the text and preview kept');

    await show(presetButton('harbor'));
    await presetButton('harbor').click();
    await pause(400);
    await show(page.getByRole('button', { name: t.settings_theme_applyimport }));
    await page.getByRole('button', { name: t.settings_theme_applyimport }).click();
    await pause(700);
    await note('Apply with an unsaved preset: asks first');
    await page.getByRole('button', { name: t.settings_unsaved_keep }).click();
    await pause(500);
    await note('Keep editing: nothing written, the draft kept');
    await page.getByRole('button', { name: t.settings_theme_applyimport }).click();
    await pause(500);
    await page.getByRole('button', { name: t.settings_chrome_scope_discardconfirm }).click();
    await pause(1300);
    await note('Discard changes: applied at once; the clean draft shows the imported Manuscript');
    await show(presetButton('manuscript'));
    await pause(900);

    assert.deepEqual(errors, []);
    const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
    assert.equal(patches.length, 2, 'one refused save, then one saved');
    assert.deepEqual(Object.keys(patches[1].body.config), ['theme'], 'a theme-only save never sends styling');
    assert.equal(patches[1].body.config.theme.preset, 'manuscript');
    const applies = requests.filter(({ body }) => body?.apply === true);
    assert.equal(applies.length, 2, 'one refused apply, then one applied after the confirmation');
    assert.equal(requests.filter(({ body }) => body?.apply === false).length, 1, 'one preview');
    assert.deepEqual(server.config.styling, { ...savedConfig.styling }, 'Styling keeps its colour and radius');
    const [opened, picked, undone, marked, refused, unmarked, failed, saved, darkened, discarded, previewed, applyFailed, asked, kept, applied] =
      steps;
    assert.equal(opened.saveBar, false);
    assert.ok(picked.saveBar);
    assert.equal(undone.saveBar, false);
    // Both colours of the failing pair are marked.
    assert.deepEqual(marked.invalid, [t.settings_theme_color_canvas, t.settings_theme_color_foreground]);
    assert.ok(refused.status.includes(t.forms_fixhighlighted));
    assert.equal(refused.focused, t.settings_theme_color_canvas);
    assert.deepEqual(unmarked.invalid, []);
    assert.ok(failed.saveBar && !failed.status.includes(t.common_saved));
    assert.equal(saved.saveBar, false);
    assert.ok(darkened.saveBar);
    assert.equal(discarded.saveBar, false);
    assert.equal(previewed.importResult, 'preview');
    assert.equal(applyFailed.importResult, 'preview');
    assert.ok(asked.dialog);
    assert.ok(kept.saveBar && !kept.dialog);
    assert.equal(applied.importResult, 'applied');
    assert.equal(applied.saveBar, false);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real Themes section (before: main; after: this branch) with the real design system, EN/AR catalogs, project query and mutations, the theme import and export mutations, ConfirmProvider and Sonner, in an editor-canvas frame; a fictional site and template; the project GET, PATCH (merged like the API) and template endpoints (on the shared theme functions) answered by interception; not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/components/project-settings/theme-section.tsx'],
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
