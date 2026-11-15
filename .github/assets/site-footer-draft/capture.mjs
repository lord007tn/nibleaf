// Isolated component fixture of Site configuration → Footer: the real section
// (features/site-footer) with the real design system, EN/AR catalogs, project
// and language queries and both save mutations, given a fictional site with an
// Arabic language. Every request is answered by interception on the fixture
// origin. Not the signed-in dashboard and not production. No server starts.
//
// Run it while holding the repository's heavy-step lock; it takes no lock itself.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
const origin = 'http://footer.fixture.test';
const savedFooter = {
  copyright: '© 2026 Handbook Ltd.',
  github: 'https://github.com/handbook-docs',
  x: 'https://x.com/handbookdocs',
  linkedin: '/company/handbook',
};
/** The Arabic language's stored config: SEO and a banner that belong to other forms, no footer yet. */
const arabicConfig = { seo: { metaTitle: 'دليل هاندبوك' }, banner: { message: 'إعلان تجريبي' } };

let harness;
try {
  harness = await mkdtemp(resolve(app, '.footer-capture-'));
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-footer";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../../../packages/design-system/src";\n',
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
import { FooterSection } from '@/components/project-settings/footer-section';
import { useProject } from '@/hooks/api';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
document.documentElement.classList.add('light');
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });

/** The editor's Configuration canvas: the site from the project query, then the section, keyed by site as the host does. */
function Canvas() {
  const { data: project } = useProject('site-1');
  return project ? <FooterSection key={project.id} project={project} /> : null;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <main className="mx-auto w-full max-w-4xl px-5 pt-7 pb-32 text-foreground sm:px-8"><Canvas /></main>
    </ConfirmProvider>
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

  /**
   * Opens the fixture over an in-page store; `server.saveDelay` holds each
   * PATCH. A project PATCH merges `config.footer` key by key; a language PATCH
   * sets its footer, and `footer: null` drops it and keeps the language's SEO
   * and banner. That is a stand-in for the API:
   * `apps/server/src/actions/{projects,languages.writes}.test.ts` run the real merges.
   */
  async function open(context, { locale }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { footer: { ...savedFooter }, arabic: structuredClone(arabicConfig), saveDelay: 0 };
    const project = () => ({
      id: 'site-1',
      name: 'Handbook',
      description: 'Guides for the Handbook team.',
      slug: 'handbook',
      config: { theme: { preset: 'nib' }, seo: { metaTitle: 'Handbook Docs' }, footer: { ...server.footer } },
    });
    const languages = () => [
      { id: 'en', projectId: 'site-1', code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, position: 0, config: null },
      {
        id: 'ar',
        projectId: 'site-1',
        code: 'ar',
        label: 'العربية',
        direction: 'RTL',
        isDefault: false,
        enabled: true,
        position: 1,
        config: structuredClone(server.arabic),
      },
    ];
    const json = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      const call = `${request.method()} ${pathname}`;
      if (call === 'GET /api/app/projects/site-1') {
        requests.push({ call });
        return json(route, { data: project() });
      }
      if (call === 'GET /api/app/projects/site-1/languages') {
        requests.push({ call });
        return json(route, { data: languages() });
      }
      if (call === 'PATCH /api/app/projects/site-1') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        await wait(server.saveDelay);
        server.footer = { ...server.footer, ...body.config.footer };
        return json(route, { data: project() });
      }
      if (call === 'PATCH /api/app/projects/site-1/languages/ar') {
        const body = request.postDataJSON();
        requests.push({ call, body });
        await wait(server.saveDelay);
        const { footer: _dropped, ...others } = server.arabic;
        server.arabic = body.config.footer === null ? others : { ...others, footer: body.config.footer };
        return json(route, { data: languages()[1] });
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}`);
    await text(page, locale, 'copyright').waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  const NAMES = ['copyright', 'github', 'x', 'linkedin'];
  const text = (page, locale, name) => page.getByRole('textbox', { name: catalogs[locale][`settings_footer_${name}_label`], exact: true });
  const badgeSwitch = (page, locale) => page.getByRole('switch', { name: catalogs[locale].settings_footer_badge_title, exact: true });
  const scope = (page, label) => page.getByRole('button', { name: label });
  const saveButton = (page, locale) => page.getByRole('button', { name: catalogs[locale].common_save, exact: true });
  /** What a reviewer should see: values, directions, read-only state, toasts, the save bar and its status. */
  const state = async (page, locale) => {
    const read = async (fn) => Object.fromEntries(await Promise.all(NAMES.map(async (name) => [name, await fn(text(page, locale, name))])));
    return {
      dir: await page.evaluate(() => document.documentElement.dir),
      fields: { ...(await read((el) => el.inputValue())), madeWithBadge: (await badgeSwitch(page, locale).getAttribute('aria-checked')) === 'true' },
      fieldDir: await read((el) => el.getAttribute('dir')),
      disabled: await read((el) => el.isDisabled()),
      toasts: await page.locator('[data-sonner-toast]').allInnerTexts(),
      saveButtonVisible: await saveButton(page, locale).isVisible(),
      // The bar's polite status stays mounted (visually hidden) when the bar hides.
      status: await page.evaluate(() => document.querySelector('div.sr-only[role="status"][aria-live="polite"]')?.textContent?.trim() ?? ''),
      overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    };
  };

  // Each scene: what the person does before the capture. Nothing is saved.
  const scenes = {
    'project-cleared': async (page, locale) => {
      await text(page, locale, 'github').fill('');
      await text(page, locale, 'copyright').fill('');
      await page.waitForTimeout(300);
    },
    'arabic-scope': async (page, locale) => {
      await scope(page, 'العربية').click();
      await text(page, locale, 'copyright').fill('© ٢٠٢٦ هاندبوك');
      await page.waitForTimeout(300);
    },
  };

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390])
        for (const [scene, act] of Object.entries(scenes)) {
          const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
          const { page, errors, requests } = await open(context, { locale });
          await act(page, locale);
          await page.mouse.move(0, 0);
          const seen = await state(page, locale);
          assert.equal(seen.dir, locale === 'ar' ? 'rtl' : 'ltr');
          assert.equal(seen.overflow, false);
          assert.deepEqual(errors, []);
          for (const name of ['github', 'x', 'linkedin']) assert.equal(seen.fieldDir[name], 'ltr');
          assert.equal(seen.fieldDir.copyright, scene === 'arabic-scope' ? 'rtl' : 'auto');
          assert.ok(!requests.some(({ call }) => call.startsWith('PATCH')), 'nothing is saved in a still capture');
          const file = `${scene}-${locale}-${width}.png`;
          const shot = await page.screenshot({ fullPage: true, animations: 'disabled' });
          await context.close();
          // Captioned so the picture says what it is.
          const sheet = await browser.newContext({ viewport: { width: width + 32, height: 600 }, deviceScaleFactor: 1 });
          const sheetPage = await sheet.newPage();
          await sheetPage.setContent(
            `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Footer section · ${scene} · ${locale.toUpperCase()} · ${width}px · unsaved draft</div>
<img src="data:image/png;base64,${shot.toString('base64')}" width="${width}"></body>`,
          );
          await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
          await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true });
          await sheet.close();
          captures.push({ file, scene, locale, width, theme: 'light', ...seen, requests: requests.map(({ call }) => call), pageErrors: errors });
        }

    // Edit → clear → save → refetch in the Default scope, then the Arabic scope's copyright saved and cleared.
    const locale = 'en';
    const width = 1440;
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 860 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 860 } },
    });
    const { page, errors, requests, server } = await open(context, { locale });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) =>
      steps.push({
        step,
        ...(await state(page, locale)),
        requestsSoFar: requests.length,
        server: { footer: { ...server.footer }, arabic: structuredClone(server.arabic) },
      });
    await pause();
    await note('opened: Default scope, pristine, no save bar');

    await text(page, locale, 'github').fill('');
    await text(page, locale, 'copyright').fill('   ');
    await pause(300);
    await note('cleared the GitHub link and the copyright');
    server.saveDelay = 900;
    await saveButton(page, locale).click();
    await pause(300);
    await note('Save pressed: saving');
    await pause(1600);
    await note('saved and refetched: both stored as "", the form clean on them');

    await badgeSwitch(page, locale).click();
    await pause(300);
    await note('turned the badge off: the toggle alone makes the draft dirty');
    await saveButton(page, locale).click();
    await pause(1600);
    await note('saved: the badge is stored as an explicit false');

    await scope(page, 'العربية').click();
    await pause();
    await note('switched to the Arabic scope: links and badge read-only, global');
    await text(page, locale, 'copyright').fill('  © ٢٠٢٦ هاندبوك  ');
    await saveButton(page, locale).click();
    await pause(1600);
    await note('saved the Arabic copyright: only the copyright is sent, trimmed');
    await text(page, locale, 'copyright').fill('');
    await saveButton(page, locale).click();
    await pause(1600);
    await note('cleared it and saved: footer null, the Arabic SEO and banner kept');

    await scope(page, /English/).click();
    await pause();
    await note('back to Default: the stored project footer');

    const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
    const at = (prefix) => steps.find(({ step }) => step.startsWith(prefix));
    assert.deepEqual(errors, []);
    assert.equal(patches.length, 4);
    assert.deepEqual(patches[0].body, { config: { footer: { ...savedFooter, copyright: '', github: '', madeWithBadge: true } } });
    assert.equal(patches[1].body.config.footer.madeWithBadge, false);
    assert.deepEqual(patches[2].body, { config: { footer: { copyright: '© ٢٠٢٦ هاندبوك' } } });
    assert.deepEqual(patches[3].body, { config: { footer: null } });
    assert.equal(at('saved and refetched').saveButtonVisible, false);
    assert.equal(at('saved and refetched').status, catalogs[locale].common_saved);
    assert.equal(at('turned the badge off').saveButtonVisible, true);
    assert.deepEqual(Object.values(at('switched to the Arabic scope').disabled), [false, true, true, true]);
    assert.deepEqual(at('cleared it and saved').server.arabic, arabicConfig);
    assert.deepEqual(steps.at(-1).fields, { ...savedFooter, copyright: '', github: '', madeWithBadge: false });
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real Footer section (features/site-footer, through its compatibility re-export) with the real design system, EN/AR catalogs, project and language queries and both save mutations, in an editor-canvas frame; fictional site and Arabic language; GETs and PATCHes answered by interception; not the signed-in dashboard or production',
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} captures and ${recordings.length} recording; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
}
