// Isolated component fixture for clearing saved banner text: the real Banner
// settings form and the real reader SiteBanner (before: both from the merge base
// with main; after: this branch), with the real design system, EN/AR catalogs,
// Query cache and mutations. The API is answered by interception with fictional
// data; a project save merges `config.banner` one level deep as the server's
// `mergeConfig` does. A reload is the remount and refetch. These are not
// signed-in dashboard, server or production captures. No server is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
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
const atBaseline = (path) => git('show', `${baseline}:${path}`);
const origin = 'http://banner-clear.fixture.test';

const BANNERS = {
  en: {
    enabled: true,
    dismissible: true,
    message: 'Spring sale: 20% off annual plans',
    linkLabel: 'See plans',
    linkUrl: 'https://example.com/pricing',
  },
  ar: {
    enabled: true,
    dismissible: true,
    message: 'تخفيضات الربيع: خصم ٢٠٪ على الخطط السنوية',
    linkLabel: 'عرض الخطط',
    linkUrl: 'https://example.com/pricing',
  },
};
const FALLBACK = { en: 'View details', ar: 'عرض التفاصيل' };
const SIBLINGS = { navbar: { ctaLabel: 'Start' }, seo: { metaTitle: 'Fixture docs' } };
const LANGUAGES = {
  en: [{ id: 'en', code: 'en', label: 'English', direction: 'LTR', isDefault: true, enabled: true, position: 0, config: null }],
  ar: [{ id: 'ar', code: 'ar', label: 'العربية', direction: 'RTL', isDefault: true, enabled: true, position: 0, config: null }],
};
/** The form's text fields, in order. */
const FIELDS = ['message', 'linkLabel', 'linkUrl'];
/** The last project read: what a reload showed. */
const readbackOf = (requests) => requests.findLast((request) => request.method === 'GET' && request.path === '/api/app/projects/site-1');

const lock = await acquireDevstackLock('banner clear saved text captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.banner-clear-capture-'));
  // Before: the settings form, its save hook, its model and the reader banner, all from the merge base.
  await mkdir(resolve(harness, 'before'));
  await writeFile(resolve(harness, 'before/banner.ts'), `${atBaseline('apps/app/src/features/site-banner/model/banner.ts')}\n`);
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    `${atBaseline('apps/app/src/features/site-banner/api/hooks.ts').replace("from '../model/banner'", "from './banner'")}\n`,
  );
  await writeFile(
    resolve(harness, 'before/banner-settings.tsx'),
    `${atBaseline('apps/app/src/features/site-banner/components/banner-settings.tsx')
      .replace("from '../api/hooks'", "from './hooks'")
      .replace("from '../model/banner'", "from './banner'")}\n`,
  );
  await writeFile(resolve(harness, 'before/site-banner.tsx'), `${atBaseline('apps/app/src/components/site/site-banner.tsx')}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-banner";\n@source "../src/components/project-settings";\n@source "../src/components/site/site-banner.tsx";\n@source "../src/lib/forms";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { SiteBanner } from '@/components/site/site-banner';
import { BannerSettings } from '@/features/site-banner/components/banner-settings';
import { queryKeys } from '@/hooks/api/query-keys';
import { BannerSettings as BeforeSettings } from './before/banner-settings';
import { SiteBanner as BeforeSiteBanner } from './before/site-banner';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add(params.get('theme') === 'dark' ? 'dark' : 'light');
const before = params.get('phase') === 'before';
const Settings = before ? BeforeSettings : BannerSettings;
const Reader = before ? BeforeSiteBanner : SiteBanner;
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const projectKey = queryKeys.projects.detail('site-1');
const read = async (path: string) => (await (await fetch(path)).json()).data;

/** Like the app's hosts: the project comes from its query, so a save's invalidation refetches it. */
function Host() {
  useQuery({ queryKey: queryKeys.languages.all('site-1'), queryFn: () => read('/api/app/projects/site-1/languages') });
  const { data: project } = useQuery({ queryKey: projectKey, queryFn: () => read('/api/app/projects/site-1') });
  if (!project) return null;
  return (
    <>
      <Settings project={project} />
      <section className="mt-8 border-border border-t pt-4" data-fixture="reader">
        <p className="mb-2 text-muted-foreground text-xs" dir="ltr">Reader banner (SiteBanner) from the stored config</p>
        <div className="min-h-10 overflow-hidden rounded-md border border-border border-dashed" dir={locale === 'ar' ? 'rtl' : 'ltr'} lang={locale}>
          <Reader banner={project.config?.banner} lang={locale} projectId="site-1" />
        </div>
      </section>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
    <QueryClientProvider client={client}>
      <ConfirmProvider>
        <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col p-4 text-foreground sm:p-8"><Host /></main>
        <Toaster position={locale === 'ar' ? 'bottom-left' : 'bottom-right'} richColors />
      </ConfirmProvider>
    </QueryClientProvider>
  </DirectionProvider>,
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

  /**
   * Serves the build and answers the API. The stored project lives in `api`, so
   * it survives a reload. A project PATCH merges each object section one level
   * deep, keeping keys the patch leaves out, as the server's `mergeConfig` does.
   * Every request is recorded with its body and answer.
   */
  const serve = async (context, api, locale) => {
    api.project ??= { id: 'site-1', config: { ...structuredClone(SIBLINGS), banner: { ...BANNERS[locale] } } };
    await context.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const { pathname } = new URL(request.url());
      if (pathname === '/sheet') return route.fulfill({ body: '<!doctype html><title>sheet</title>', contentType: 'text/html' });
      if (pathname.startsWith('/api/')) {
        const entry = { method: request.method(), path: pathname };
        api.requests.push(entry);
        if (pathname.endsWith('/languages')) return route.fulfill({ json: { data: LANGUAGES[locale] } });
        if (request.method() === 'PATCH') {
          entry.body = request.postDataJSON();
          for (const [key, value] of Object.entries(entry.body.config ?? {})) {
            const stored = api.project.config[key];
            api.project.config[key] = value && typeof value === 'object' && !Array.isArray(value) ? { ...stored, ...value } : value;
          }
        }
        entry.answer = structuredClone(api.project);
        return route.fulfill({ json: { data: api.project } });
      }
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      return route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
  };

  const textInputs = (page) => page.locator('main form input[dir]');
  const saveButton = (page) => page.locator('[data-slot="save-region"] button').last();
  const settle = (page, ms = 300) => page.waitForTimeout(ms);
  const open = async (page, url) => {
    await page.goto(url);
    await textInputs(page).first().waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
  };
  /** Clears one field, saves, and waits for the save's refetch to settle. */
  const clearAndSave = async (page, field) => {
    await textInputs(page).nth(FIELDS.indexOf(field)).fill('');
    const patched = page.waitForResponse((response) => response.request().method() === 'PATCH');
    await saveButton(page).click();
    await patched;
    await settle(page, 600);
  };

  const state = async (page) => {
    const reader = page.locator('[data-fixture="reader"] [data-theme-region="banner"]');
    const shown = (await reader.count()) > 0;
    const link = reader.locator('a');
    return {
      fields: Object.fromEntries(
        await textInputs(page).evaluateAll((items, names) => items.map((item, index) => [names[index], item.value]), FIELDS),
      ),
      saveVisible: (await page.locator('[data-slot="save-region"]').count()) > 0,
      reader: shown
        ? {
            message: (await reader.locator('span').first().textContent())?.trim() ?? null,
            link: (await link.count()) > 0 ? { href: await link.getAttribute('href'), name: (await link.textContent())?.trim() ?? null } : null,
          }
        : null,
    };
  };

  const scenes = FIELDS.map((field) => ({
    name: `clear-${field}`,
    field,
    label: {
      message: 'Cleared the saved message, saved, reloaded',
      linkLabel: 'Cleared the saved link label, saved, reloaded',
      linkUrl: 'Cleared the saved link address, saved, reloaded',
    }[field],
  }));

  /** Checks one capture: before, the old text comes back; after, it stays cleared and the reader follows. */
  const check = (scene, phase, locale, observed, requests) => {
    const saved = BANNERS[locale];
    const patch = requests.find((request) => request.method === 'PATCH');
    const readback = readbackOf(requests);
    if (phase === 'before') {
      assert.equal(Object.hasOwn(patch.body.config.banner, scene.field), false);
      assert.equal(readback.answer.config.banner[scene.field], saved[scene.field]);
      assert.equal(observed.fields[scene.field], saved[scene.field]);
      return;
    }
    assert.equal(patch.body.config.banner[scene.field], '');
    assert.deepEqual(readback.answer.config, { ...SIBLINGS, banner: { ...saved, [scene.field]: '' } });
    assert.equal(observed.fields[scene.field], '');
    assert.equal(observed.saveVisible, false);
    if (scene.field === 'message') assert.equal(observed.reader, null);
    if (scene.field === 'linkUrl') assert.deepEqual(observed.reader, { message: saved.message, link: null });
    if (scene.field === 'linkLabel')
      assert.deepEqual(observed.reader, { message: saved.message, link: { href: saved.linkUrl, name: FALLBACK[locale] } });
  };

  /** Lays two screenshots per scene side by side under labels, in a canvas on the fixture origin. */
  const sheet = async (context, title, rows) => {
    const page = await context.newPage();
    await page.goto(`${origin}/sheet`);
    const png = await page.evaluate(
      async ({ title, rows }) => {
        const load = (src) =>
          new Promise((done, fail) => {
            const image = new Image();
            image.onload = () => done(image);
            image.onerror = fail;
            image.src = src;
          });
        const loaded = await Promise.all(rows.map(async (row) => ({ ...row, before: await load(row.before), after: await load(row.after) })));
        const gap = 24;
        const band = 40;
        const rowBand = 60;
        const column = Math.max(...loaded.flatMap((row) => [row.before.width, row.after.width]));
        const width = column * 2 + gap * 3;
        const height = band + loaded.reduce((sum, row) => sum + rowBand + Math.max(row.before.height, row.after.height) + gap, gap);
        const canvas = Object.assign(document.createElement('canvas'), { width, height });
        const draw = canvas.getContext('2d');
        draw.fillStyle = '#e5e7eb';
        draw.fillRect(0, 0, width, height);
        draw.fillStyle = '#111827';
        draw.font = 'bold 20px sans-serif';
        draw.fillText(title, gap, 28, width - gap * 2);
        let y = band + gap;
        for (const row of loaded) {
          draw.font = 'bold 16px sans-serif';
          draw.fillText(row.label, gap, y + 20, width - gap * 2);
          draw.font = '16px sans-serif';
          draw.fillText('Before (main)', gap, y + 46);
          draw.fillText('After (this PR)', gap * 2 + column, y + 46);
          draw.drawImage(row.before, gap, y + rowBand);
          draw.drawImage(row.after, gap * 2 + column, y + rowBand);
          y += rowBand + Math.max(row.before.height, row.after.height) + gap;
        }
        return canvas.toDataURL('image/png').split(',')[1];
      },
      { title, rows },
    );
    await page.close();
    return Buffer.from(png, 'base64');
  };

  const captures = [];
  const sheets = [];
  let recording;
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390])
        for (const theme of ['light', 'dark']) {
          const rows = [];
          for (const scene of scenes) {
            const shots = {};
            for (const phase of ['before', 'after']) {
              const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: theme });
              const api = { requests: [] };
              await serve(context, api, locale);
              const page = await context.newPage();
              const errors = [];
              page.on('pageerror', (error) => errors.push(error.message));
              const url = `${origin}/?locale=${locale}&phase=${phase}&theme=${theme}`;
              await open(page, url);
              await clearAndSave(page, scene.field);
              // Opening the page again: a fresh mount and a refetch from the stored config.
              await open(page, url);
              await settle(page);
              const dir = await page.evaluate(() => document.documentElement.dir);
              const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
              const observed = await state(page);
              assert.equal(dir, locale === 'ar' ? 'rtl' : 'ltr');
              assert.equal(overflow, false);
              assert.deepEqual(errors, []);
              check(scene, phase, locale, observed, api.requests);
              const shot = await page.screenshot({ fullPage: true, animations: 'disabled' });
              shots[phase] = `data:image/png;base64,${shot.toString('base64')}`;
              captures.push({
                scene: scene.name,
                phase,
                locale,
                width,
                theme,
                dir,
                overflow,
                errors,
                request: api.requests.find((request) => request.method === 'PATCH')?.body,
                readback: readbackOf(api.requests).answer.config,
                ...observed,
              });
              await context.close();
            }
            rows.push({ label: scene.label, ...shots });
          }
          const file = `sheet-${locale}-${width}-${theme}.png`;
          const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
          await serve(context, { requests: [] }, locale);
          await writeFile(
            resolve(import.meta.dirname, file),
            await sheet(
              context,
              `Component fixture, not the dashboard or production · Clear saved banner text · ${locale.toUpperCase()} · ${width} px · ${theme}`,
              rows,
            ),
          );
          await context.close();
          sheets.push(file);
        }

    // One recorded flow (after): clear the label, save, reload; then clear the message, save, reload.
    const videoDir = await mkdtemp(resolve(harness, 'video-'));
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
      recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
    });
    const api = { requests: [] };
    await serve(context, api, 'en');
    const page = await context.newPage();
    const url = `${origin}/?locale=en&phase=after&theme=light`;
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page)) });
    await open(page, url);
    await settle(page, 1000);
    await note('Saved banner: message, label and address');
    await textInputs(page).nth(1).fill('');
    await note('Cleared the link label');
    await settle(page, 800);
    await clearAndSave(page, 'linkLabel');
    await note('Saved: the bar closes, the label stays empty');
    await settle(page, 800);
    await open(page, url);
    await settle(page, 1200);
    await note('Reopened: the label is still empty; the reader link reads "View details"');
    await textInputs(page).nth(0).fill('');
    await settle(page, 800);
    await clearAndSave(page, 'message');
    await open(page, url);
    await settle(page, 1500);
    await note('Cleared the message, saved and reopened: the message stays empty and the reader shows no banner');
    const video = page.video();
    await context.close();
    recording = 'flow-after-en-1440.webm';
    await rename(await video.path(), resolve(import.meta.dirname, recording));
    assert.equal(steps[3].fields.linkLabel, '');
    assert.deepEqual(steps[3].reader?.link, { href: BANNERS.en.linkUrl, name: FALLBACK.en });
    assert.equal(steps.at(-1).fields.message, '');
    assert.equal(steps.at(-1).reader, null);
    assert.deepEqual(api.project.config, { ...SIBLINGS, banner: { ...BANNERS.en, message: '', linkLabel: '' } });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Isolated component fixture: the real Banner settings form and reader SiteBanner (before: merge base with main; after: this PR) with the real design system, EN/AR catalogs, Query cache and mutations. API answered by interception with fictional data; a project PATCH merges config.banner one level deep like the server mergeConfig. Not the dashboard, the server or production. The real server merge is covered by apps/server/src/actions/projects.test.ts.',
      baseline,
      head: git('rev-parse', 'HEAD'),
      attempted: attempted.length,
      sheets,
      captures,
      recording: { file: recording, locale: 'en', width: 1440, theme: 'light', requests: api.requests, steps },
    });
  });
  console.log(`${captures.length} captures in ${sheets.length} sheets and ${recording}; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
