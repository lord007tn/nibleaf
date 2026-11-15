// Isolated component fixture of Site configuration → Navbar: the real section
// (before: the main-branch component; after: features/site-navbar) with the
// real design system, EN/AR catalogs, project and languages queries and their
// mutations, given a fictional site with a fictional public navbar and an
// Arabic override. The project and languages GETs (from an in-page store) and
// both PATCHes (merged as the API merges) are answered by interception on the
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
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
// main's section, with the two compact field tokens it used (gone from shared.tsx with it) copied from main.
const mainTokens = git('show', `${baseline}:apps/app/src/components/project-settings/shared.tsx`)
  .split(/\r?\n/)
  .filter((line) => /^export const FIELD_COMPACT(_MONO)? =/.test(line))
  .map((line) => line.replace('export ', ''));
assert.equal(mainTokens.length, 2);
const beforeSource = [
  git('show', `${baseline}:apps/app/src/components/project-settings/navbar-section.tsx`)
    .replace("from './shared'", "from '@/components/project-settings/shared'")
    .replace(/\s*FIELD_COMPACT,\s*FIELD_COMPACT_MONO,/, ''),
  ...mainTokens,
].join('\n');
assert.ok(!/FIELD_COMPACT,\s*FIELD_COMPACT_MONO,/.test(beforeSource));
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://navbar.fixture.test';
/** The fictional site's stored navbar. */
const savedNavbar = {
  ctaLabel: 'Book a demo',
  ctaUrl: 'https://handbook.example.com/demo',
  links: [
    { label: 'Guides', href: '/guides' },
    { label: 'Blog', href: 'https://blog.example.com', external: true },
  ],
  tabs: [{ label: 'API reference', href: '/api' }],
  anchors: [{ label: 'Community', href: 'https://community.example.com', icon: 'users' }],
  showSearch: true,
  changelog: false,
};
/** Its Arabic override, beside Arabic SEO that belongs to another form. */
const savedArabic = {
  seo: { metaTitle: 'دليل' },
  navbar: { ctaLabel: 'احجز عرضًا', links: [{ label: 'الأدلة', href: '/guides' }] },
};
const languages = (arabicConfig) => [
  { id: 'en', code: 'en', label: 'English', direction: 'LTR', enabled: true, isDefault: true, position: 0, config: null },
  { id: 'ar', code: 'ar', label: 'العربية', direction: 'RTL', enabled: true, isDefault: false, position: 1, config: arabicConfig },
];

const lock = await acquireDevstackLock('site navbar draft captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.navbar-capture-'));
  await writeFile(resolve(harness, 'before-section.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-navbar";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../../../packages/design-system/src";\n',
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
import { NavbarSettings } from '@/features/site-navbar/components/navbar-settings';
import { useProject } from '@/hooks/api';
import { NavbarSection as BeforeSection } from './before-section';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
document.documentElement.classList.add('light');
const Section = params.get('phase') === 'before' ? BeforeSection : NavbarSettings;
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

  /** Opens the fixture over an in-page store of the site. `server.failNext` refuses the next PATCH. */
  async function open(context, { phase, locale, scope }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const server = { navbar: structuredClone(savedNavbar), arabic: structuredClone(savedArabic), failNext: false };
    const project = () => ({
      id: 'site-1',
      name: 'Handbook',
      slug: 'handbook',
      config: { theme: { preset: 'nib' }, footer: { copyright: '© Handbook' }, navbar: server.navbar },
    });
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
        return json(route, { data: languages(server.arabic) });
      }
      if (request.method() === 'PATCH' && pathname.startsWith('/api/app/projects/site-1')) {
        const body = request.postDataJSON();
        requests.push({ call, body });
        if (server.failNext) {
          server.failNext = false;
          return json(route, { error: { code: 'internal', message: 'The fixture refused this save.' } }, 500);
        }
        if (call === 'PATCH /api/app/projects/site-1') {
          // The API's merge: an object section merges one level deep, arrays replace.
          server.navbar = { ...server.navbar, ...body.config.navbar };
          return json(route, { data: project() });
        }
        if (call === 'PATCH /api/app/projects/site-1/languages/ar') {
          // A language's chrome section is replaced whole; null removes it.
          const { navbar, ...rest } = server.arabic;
          server.arabic = body.config.navbar ? { ...rest, navbar: body.config.navbar } : rest;
          return json(route, { data: languages(server.arabic)[1] });
        }
      }
      assert.ok(!pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}`);
    await page.getByText(catalogs[locale].settings_navbar_ctalabel_label, { exact: true }).first().waitFor({ timeout: 15_000 });
    if (scope === 'language') {
      await page.getByRole('button', { name: 'العربية' }).click();
      await page.waitForTimeout(300);
    }
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  /** What a reviewer should see: the CTA, the rows, field names and directions, focus, toasts, the save bar, overflow. */
  const state = (page) =>
    page.evaluate(() => {
      const nameOf = (element) => {
        if (!element) return null;
        const ids = element.getAttribute('aria-labelledby');
        if (ids)
          return ids
            .split(' ')
            .map((id) => {
              const target = document.getElementById(id);
              return target === element ? element.getAttribute('aria-label') : target?.textContent?.trim();
            })
            .join(' ');
        const label = element.id ? document.querySelector(`label[for="${element.id}"]`) : null;
        return label?.textContent?.trim() || element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName;
      };
      const inputs = [...document.querySelectorAll('main input')];
      const active = document.activeElement;
      return {
        dir: document.documentElement.dir,
        fields: inputs.map((input) => ({ name: nameOf(input), value: input.value, dir: input.dir, disabled: input.disabled })),
        removeNames: [...document.querySelectorAll('main button[aria-label]')]
          .filter((button) => /remove|إزالة/i.test(button.getAttribute('aria-label') ?? ''))
          .map(nameOf),
        invalid: [...document.querySelectorAll('[aria-invalid="true"]')].map(nameOf),
        focused: active && active !== document.body ? nameOf(active) : null,
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
    // Before/after pairs for both scopes, EN and AR, 1440 and 390, light theme, as they open.
    for (const scope of ['project', 'language'])
      for (const locale of ['en', 'ar'])
        for (const width of [1440, 390]) {
          const shots = {};
          const seen = {};
          for (const phase of ['before', 'after']) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', colorScheme: 'light' });
            const { page, errors, requests } = await open(context, { phase, locale, scope });
            await page.mouse.move(0, 0);
            seen[phase] = { ...(await state(page)), requests, pageErrors: errors };
            assert.equal(seen[phase].dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.deepEqual(errors, []);
            if (phase === 'after') {
              assert.equal(seen[phase].overflow, false);
              assert.equal(seen[phase].saveBar, false);
            }
            shots[phase] = await page.screenshot({ fullPage: true, animations: 'disabled' });
            await context.close();
          }
          const file = `${scope}-${locale}-${width}.png`;
          const sheet = await browser.newContext({ viewport: { width: width * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
          const sheetPage = await sheet.newPage();
          const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
          await sheetPage.setContent(
            `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production) · Navbar section · ${scope === 'project' ? 'Default scope' : 'Arabic scope'} · UI ${locale.toUpperCase()} · ${width}px · light</div>
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
          captures.push({ file, scope, locale, width, theme: 'light', before: seen.before, after: seen.after });
        }

    // The new form: Add, Remove, Undo, clear the CTA, a refused save, a save, then a discard.
    const locale = 'en';
    const width = 1440;
    const t = catalogs[locale];
    const file = `flow-${locale}-${width}.webm`;
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width, height: 900 } },
    });
    const { page, errors, requests, server } = await open(context, { phase: 'after', locale, scope: 'project' });
    const pause = (ms = 700) => page.waitForTimeout(ms);
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await state(page)) });
    const typeSlowly = (text) => page.keyboard.type(text, { delay: 50 });
    const field = (name) => page.getByLabel(name, { exact: true });
    await pause();
    await note('opened: the stored navbar, no save bar');

    await page.getByRole('button', { name: t.settings_navbar_links_add }).click();
    await pause(300);
    await typeSlowly('Pricing');
    await page.keyboard.press('Tab');
    await typeSlowly('/pricing');
    await pause(300);
    await note('Add link: focus on its label; Pricing, Tab, /pricing');

    await page.getByRole('button', { name: `${t.settings_navbar_links_remove} Blog` }).click();
    await pause(400);
    await note('Remove link Blog: gone from the draft, focus on the next Remove, Undo offered');
    await page.getByRole('button', { name: t.settings_theme_undo }).click();
    await pause(500);
    await note('Undo: Blog is back in place with its external flag, focus on its label');

    await page.getByRole('button', { name: `${t.settings_navbar_tabs_remove} API reference` }).click();
    await pause(300);
    await field(t.settings_navbar_ctalabel_label).fill('');
    await field(t.settings_navbar_ctaurl_label).fill('');
    await pause(400);
    await note('the only tab removed, and both CTA texts cleared');

    server.failNext = true;
    await page.keyboard.press('Control+s');
    await pause(1000);
    await note('Ctrl+S, refused by the server: one error toast, the draft and its edits kept, no "Saved"');

    await page.keyboard.press('Control+s');
    await pause(1200);
    await note('Ctrl+S again: saved and refetched; the CTA is cleared, the tabs are [], no save bar');

    await page.getByRole('switch', { name: t.settings_navbar_showsearch_title }).click();
    await pause(400);
    await note('the search switch turned off: the save bar shows');
    await page.getByRole('button', { name: t.forms_discard }).click();
    await pause(600);
    await note('Discard: the switch is back on, no save bar');

    assert.deepEqual(errors, []);
    const patches = requests.filter(({ call }) => call.startsWith('PATCH'));
    assert.equal(patches.length, 2, 'one refused save, then one saved');
    assert.deepEqual(patches[0].body, patches[1].body, 'the refused draft was kept and sent again unchanged');
    // Only what changed: the cleared CTA texts as '', and the two lists that changed, whole. The anchors and switches are left out.
    assert.deepEqual(patches[1].body, {
      config: {
        navbar: {
          ctaLabel: '',
          ctaUrl: '',
          links: [...savedNavbar.links, { label: 'Pricing', href: '/pricing' }],
          tabs: [],
        },
      },
    });
    assert.deepEqual(server.navbar, { ...savedNavbar, ...patches[1].body.config.navbar });
    assert.ok(requests.filter(({ call }) => call === 'GET /api/app/projects/site-1').length >= 2, 'the save is followed by a refetch');
    const [opened, added, removed, undone, , refused, saved, toggled, discarded] = steps;
    assert.equal(opened.saveBar, false);
    assert.equal(added.focused, t.editor_format_linkprompt);
    assert.equal(removed.focused, `${t.settings_navbar_links_remove} Pricing`);
    assert.equal(undone.focused, t.settings_banner_linklabel_label);
    assert.ok(refused.saveBar && !refused.status.includes(t.common_saved));
    assert.equal(saved.saveBar, false);
    assert.ok(saved.status.includes(t.common_saved));
    assert.ok(toggled.saveBar);
    assert.equal(discarded.saveBar, false);
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(import.meta.dirname, file));
    recordings.push({ file, locale, width, theme: 'light', requests, pageErrors: errors, steps });

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real Navbar section (before: main; after: this branch) with the real design system, EN/AR catalogs, project and languages queries and mutations, ConfirmProvider and Sonner, in an editor-canvas frame; fictional site with a fictional public navbar and Arabic override; GETs and PATCHes (merged like the API) answered by interception; not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/components/project-settings/navbar-section.tsx'],
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
