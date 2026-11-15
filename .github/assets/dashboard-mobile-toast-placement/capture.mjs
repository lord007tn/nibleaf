// Isolated component fixture: the real dashboard provider (AppProviders, with
// Sonner's toast host), the real SaveRegion and the real Site settings →
// Analytics form, in a stand-in dashboard frame (a sticky 48px header and the
// PageContainer column) with a fictional site. The form's one request, the
// config PATCH, is answered by interception: it fails (network, 409, 500) and
// then succeeds. Not the signed-in dashboard and not production; no server
// starts and no phone was used. "before" swaps in main's app-providers.tsx;
// "after-703" also swaps in PR #703's deferred toast host.
//
// The on-screen keyboard is simulated: `visualViewport.height` is overridden
// to 55% of the window and a `resize` event is dispatched, which is what the
// SaveRegion listens to. The layout viewport does not change and no keyboard
// is drawn.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
/** PR #703's head when these captures were made (perf/auth-lazy-toaster). */
const pr703 = 'e8b7b6a3ccef22af28f0babb1bba9f2ef9919b19';
const has703 = (() => {
  try {
    git('cat-file', '-e', `${pr703}^{commit}`);
    return true;
  } catch {
    return false;
  }
})();
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const origin = 'http://toasts.fixture.test';
const savedAnalytics = { ga4: 'G-4H7K2M9Q1Z', cookieConsent: true };
/** What the PATCH answers, in order; anything after the list succeeds. */
const failures = { network: ['network'], stacked: ['network', 409, 500] };

const lock = await acquireDevstackLock('dashboard mobile toast placement captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.toast-capture-'));
  const write = async (file, text) => {
    await mkdir(dirname(resolve(harness, file)), { recursive: true });
    await writeFile(resolve(harness, file), `${text}\n`);
  };
  await write('before/app-providers.tsx', git('show', `${baseline}:apps/app/src/components/app-providers.tsx`));
  await write('after/app-providers.tsx', await readFile(resolve(app, 'src/components/app-providers.tsx'), 'utf8'));
  if (has703) {
    const at703 = (path) => git('show', `${pr703}:apps/app/src/components/${path}`).replaceAll("'@/components/", "'./");
    for (const file of ['localized-product-providers.tsx', 'deferred-toaster.tsx', 'deferred-toaster-loader.ts'])
      await write(`pr703/${file}`, at703(file));
    await write(
      'pr703/app-providers.tsx',
      (await readFile(resolve(app, 'src/components/app-providers.tsx'), 'utf8')).replace(
        "'@/components/localized-product-providers'",
        "'./localized-product-providers'",
      ),
    );
  } else {
    await write('pr703/app-providers.tsx', "export { AppProviders } from '../after/app-providers';");
  }
  await write(
    'index.html',
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await write(
    'styles.css',
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-analytics-settings";\n@source "../src/lib/forms";\n@source "../src/components/ui";',
  );
  await write(
    'main.tsx',
    `
import './styles.css';
import { PageContainer } from '@nibleaf/design-system/components/ui/page-container';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useT } from '@nibleaf/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { AnalyticsSettings } from '@/features/site-analytics-settings/components/analytics-settings';
import { AppProviders as Before } from './before/app-providers';
import { AppProviders as After } from './after/app-providers';
import { AppProviders as After703 } from './pr703/app-providers';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.lang = locale;
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
document.documentElement.classList.add(theme);
document.documentElement.style.colorScheme = theme;
const AppProviders = { before: Before, after: After, 'after-703': After703 }[params.get('phase') ?? 'after'] ?? After;
const project = { id: 'site-1', name: 'Handbook', slug: 'handbook', config: { theme: { preset: 'nib' }, analytics: ${JSON.stringify(savedAnalytics)} } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

function Page() {
  const t = useT();
  return (
    <div data-dashboard-shell="">
      <header className="sticky top-0 z-30 flex h-12 items-center border-border border-b bg-background px-4 font-medium text-sm">Handbook</header>
      <main id="main-content">
        <PageContainer>
          <PageHeader title={t('settings.integrations.title')} />
          <AnalyticsSettings project={project as never} />
        </PageContainer>
      </main>
    </div>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <AppProviders><Page /></AppProviders>
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
      // Without TanStack Start's plugin the isomorphic API origin keeps its server branch; the browser takes the client one.
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

  /** Opens the fixture. The PATCH answers each entry of `plan` in turn (a network failure or an error status), then succeeds. */
  async function open(context, { phase, locale, theme }, plan = []) {
    const page = await context.newPage();
    const errors = [];
    const consoleErrors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      // The refused requests themselves, and friendlyErrorMessage logging the error it explains, are expected.
      const expected = /^Failed to load resource|ApiResponseError|Failed to fetch/;
      if (message.type() === 'error' && !expected.test(message.text())) consoleErrors.push(message.text());
    });
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) {
        assert.equal(`${request.method()} ${pathname}`, 'PATCH /api/app/projects/site-1');
        const body = request.postDataJSON();
        const answer = plan[requests.length] ?? 200;
        requests.push({ answer, body });
        if (answer === 'network') return route.abort('internetdisconnected');
        if (answer !== 200) {
          return route.fulfill({
            status: answer,
            contentType: 'application/json',
            body: JSON.stringify({ error: { code: 'fixture', message: 'Fixture refusal' } }),
          });
        }
        const analytics = { ...savedAnalytics, ...body.config.analytics };
        const data = { id: 'site-1', name: 'Handbook', slug: 'handbook', config: { theme: { preset: 'nib' }, analytics } };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
      }
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}&theme=${theme}`);
    await ga4(page).waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, consoleErrors, requests };
  }

  const ga4 = (page) => page.locator('input[placeholder="G-XXXXXXXXXX"]');
  const bar = (page) => page.locator('[data-slot="save-region"]');
  const saveButton = (page, locale) => bar(page).getByRole('button', { name: catalogs[locale].common_save, exact: true });
  const discardButton = (page, locale) => bar(page).getByRole('button', { name: catalogs[locale].forms_discard, exact: true });
  /**
   * A real tap (a click on desktop) at the control's centre. A capture-phase
   * listener records which element the browser delivered the click to and stops
   * it there, so nothing is saved or discarded. 'control' means the tap reached
   * the button; 'toast' means a toast took it.
   */
  const tapLands = async (page, locator, touch) => {
    const box = await locator.boundingBox();
    if (!box) return null;
    await page.evaluate(() => {
      window.__tapTarget = null;
      const stop = (event) => {
        window.__tapTarget = event.target;
        event.stopPropagation();
        event.preventDefault();
      };
      window.addEventListener('click', stop, { capture: true, once: true });
    });
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
    return locator.evaluate((control) => {
      const target = window.__tapTarget;
      if (!target) return 'none';
      if (control.contains(target)) return 'control';
      return target.closest('[data-sonner-toast]') ? 'toast' : target.tagName.toLowerCase();
    });
  };
  /** Saves with Ctrl+S from the field, so the scene goes on even where a toast covers the bar. */
  const saveFromKeyboard = async (page, toasts) => {
    await ga4(page).focus();
    await page.keyboard.press('Control+s');
    await page
      .locator('[data-sonner-toast][data-mounted="true"]')
      .nth(toasts - 1)
      .waitFor({ timeout: 5000 });
    await page.waitForTimeout(450);
  };
  /** Opens the simulated on-screen keyboard: the visual viewport shrinks to 55% of the window. */
  const openKeyboard = (page) =>
    page.evaluate(() => {
      const height = Math.round(window.innerHeight * 0.55);
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => height });
      window.visualViewport.dispatchEvent(new Event('resize'));
      return height;
    });

  /** Boxes of the toasts, the bar, Save and Discard, whether any toast overlaps a control, and where a tap at each control's points lands. */
  const geometry = (page) =>
    page.evaluate(() => {
      const box = (element) => {
        if (!element) return null;
        const r = element.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      };
      const overlaps = (a, b) => a && b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const region = document.querySelector('[data-slot="save-region"]');
      const [discard, save] = region ? region.querySelectorAll('button') : [];
      /** elementFromPoint at the centre and four points 4px inside each corner. */
      const hits = (element) => {
        if (!element) return null;
        const r = element.getBoundingClientRect();
        const points = [
          [r.x + r.width / 2, r.y + r.height / 2],
          [r.x + 4, r.y + 4],
          [r.right - 4, r.y + 4],
          [r.x + 4, r.bottom - 4],
          [r.right - 4, r.bottom - 4],
        ];
        return points.map(([x, y]) => {
          const target = document.elementFromPoint(x, y);
          if (target && element.contains(target)) return 'control';
          if (target?.closest('[data-sonner-toast]')) return 'toast';
          return target ? target.tagName.toLowerCase() : 'outside';
        });
      };
      const toasts = [...document.querySelectorAll('[data-sonner-toast]')]
        .filter((toast) => toast.dataset.removed !== 'true' && toast.dataset.visible !== 'false')
        .map((toast) => ({
          ...box(toast),
          type: toast.dataset.type,
          front: toast.dataset.front === 'true',
          expanded: toast.dataset.expanded === 'true',
        }));
      const title = document.querySelector('[data-sonner-toast][data-front="true"] [data-title]');
      const lineHeight = title ? Number.parseFloat(getComputedStyle(title).lineHeight) : 0;
      const host = document.querySelector('[data-sonner-toaster]');
      return {
        window: { w: innerWidth, h: innerHeight },
        visualViewportHeight: Math.round(window.visualViewport.height),
        bar: region ? { ...box(region), docked: region.hasAttribute('data-docked') } : null,
        saveRegionH: getComputedStyle(document.documentElement).getPropertyValue('--save-region-h') || null,
        save: box(save),
        discard: box(discard),
        toasts,
        toastOverControl: toasts.some((toast) => overlaps(toast, box(save)) || overlaps(toast, box(discard))),
        saveHits: hits(save),
        discardHits: hits(discard),
        frontToast: title
          ? {
              lines: Math.round(title.getBoundingClientRect().height / lineHeight),
              clipped: title.scrollWidth > title.clientWidth,
              text: title.textContent,
            }
          : null,
        host: host
          ? {
              yPosition: host.dataset.yPosition,
              xPosition: host.dataset.xPosition,
              inDashboardScope: Boolean(host.closest('[data-dashboard-toasts]')),
              liveRegion: host.closest('section')?.getAttribute('aria-live') ?? null,
            }
          : null,
        sections: document.querySelectorAll('section[aria-label][aria-live="polite"]').length,
        focus: document.activeElement?.getAttribute('placeholder') ?? document.activeElement?.tagName.toLowerCase(),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });

  /** Each scene leaves the page in the state that is measured. */
  const scenes = {
    // One failed save: a long network error that wraps.
    'error-floating': async (page) => {
      await ga4(page).fill('G-7N3P5R8T2V');
      await saveFromKeyboard(page, 1);
    },
    // Three failed saves stacked (network, 409, 500), then the stack expanded the way a pointer or touch expands it.
    'stacked-floating': async (page) => {
      await ga4(page).fill('G-7N3P5R8T2V');
      for (const count of [1, 2, 3]) await saveFromKeyboard(page, count);
      await page.locator('[data-sonner-toast][data-front="true"]').hover();
      await page.waitForTimeout(450);
    },
    // The person goes back into the field to correct it: keyboard open, the bar docks at the end of the form.
    'stacked-docked': async (page) => {
      await ga4(page).fill('G-7N3P5R8T2V');
      for (const count of [1, 2, 3]) await saveFromKeyboard(page, count);
      await ga4(page).focus();
      const keyboardTop = await openKeyboard(page);
      await page.locator('[data-slot="save-region"][data-docked]').waitFor();
      // Scroll toward the docked bar as far as the page goes. This form ends with it, so the page stops at its end and the bar stays below the simulated keyboard's top; a phone would pan the visual viewport to show it.
      await page.evaluate((top) => {
        const region = document.querySelector('[data-slot="save-region"]');
        window.scrollBy(0, region.getBoundingClientRect().bottom - (top - 8));
      }, keyboardTop);
      await page.waitForTimeout(450);
    },
    // Discarded: the bar hides; the error toasts stay until they time out.
    'stacked-hidden': async (page, locale) => {
      await ga4(page).fill('G-7N3P5R8T2V');
      for (const count of [1, 2, 3]) await saveFromKeyboard(page, count);
      await discardButton(page, locale).focus();
      await page.keyboard.press('Enter');
      await bar(page).waitFor({ state: 'detached' });
      await page.waitForTimeout(300);
    },
  };
  const planFor = (scene) => (scene === 'error-floating' ? failures.network : failures.stacked);

  // Phones run every scene; 1440 checks desktop placement is unchanged; 768 and a landscape phone are measured for the record.
  const layouts = [
    { name: '390', viewport: { width: 390, height: 664 }, touch: true, shots: ['error-floating', 'stacked-floating', 'stacked-docked'] },
    { name: '1440', viewport: { width: 1440, height: 900 }, touch: false, shots: ['stacked-floating'] },
    {
      name: '320',
      viewport: { width: 320, height: 568 },
      touch: true,
      shots: ['stacked-floating', 'stacked-docked'],
      locales: ['en'],
      themes: ['light'],
    },
    { name: '768', viewport: { width: 768, height: 1024 }, touch: true, shots: [], locales: ['en'], themes: ['light'] },
    { name: '844x390', viewport: { width: 844, height: 390 }, touch: true, shots: ['stacked-floating'], locales: ['en'], themes: ['light'] },
  ];
  const phases = ['before', 'after', ...(has703 ? ['after-703'] : [])];

  const measurements = [];
  const shots = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    const newContext = (layout, theme, extra = {}) =>
      browser.newContext({
        viewport: layout.viewport,
        hasTouch: layout.touch,
        isMobile: layout.touch,
        colorScheme: theme,
        reducedMotion: 'reduce',
        ...extra,
      });
    for (const layout of layouts)
      for (const locale of layout.locales ?? ['en', 'ar'])
        for (const phase of phases)
          for (const scene of Object.keys(scenes)) {
            if (scene === 'stacked-docked' && !layout.touch) continue;
            const images = {};
            for (const theme of layout.themes ?? ['light', 'dark']) {
              // PR #703 is a compatibility check: one theme, no screenshots.
              if (phase === 'after-703' && theme === 'dark') continue;
              const context = await newContext(layout, theme);
              const { page, errors, consoleErrors, requests } = await open(context, { phase, locale, theme }, planFor(scene));
              await scenes[scene](page, locale);
              const seen = await geometry(page);
              if (layout.shots.includes(scene) && phase !== 'after-703') images[theme] = await page.screenshot({ animations: 'disabled' });
              const saveTap = seen.save ? await tapLands(page, saveButton(page, locale), layout.touch) : null;
              const discardTap = seen.discard ? await tapLands(page, discardButton(page, locale), layout.touch) : null;
              assert.deepEqual(errors, [], `${phase} ${scene} ${locale} ${layout.name}: page errors`);
              assert.deepEqual(consoleErrors, [], `${phase} ${scene} ${locale} ${layout.name}: console errors`);
              assert.equal(seen.overflow, false);
              assert.equal(seen.sections, 1, 'one toast host');
              if (phase !== 'before' && (layout.name === '390' || layout.name === '320' || layout.name === '844x390')) {
                assert.equal(seen.toastOverControl, false, `${phase} ${scene} ${locale} ${layout.name}: a toast over Save or Discard`);
                if (seen.save) assert.deepEqual([saveTap, discardTap], ['control', 'control'], `${phase} ${scene} ${locale} ${layout.name}: taps`);
              }
              measurements.push({
                phase,
                scene,
                locale,
                layout: layout.name,
                theme,
                ...seen,
                saveTap,
                discardTap,
                requests: requests.map((request) => request.answer),
                stillDirty: (await ga4(page).inputValue()) === 'G-7N3P5R8T2V',
              });
              await context.close();
            }
            if (Object.keys(images).length === 0) continue;
            const file = `${scene}-${phase}-${locale}-${layout.name}.png`;
            const width = layout.viewport.width;
            const sheet = await browser.newContext({ viewport: { width: width * 2 + 48, height: 400 }, deviceScaleFactor: 1 });
            const sheetPage = await sheet.newPage();
            const img = (buffer) => `data:image/png;base64,${buffer.toString('base64')}`;
            await sheetPage.setContent(
              `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div style="margin-bottom:8px"><b>Component fixture</b> (not the dashboard, not production${scene.endsWith('docked') ? '; keyboard simulated, line = top of the simulated keyboard' : ''}) · ${phase} · ${scene} · ${locale.toUpperCase()} · ${layout.viewport.width}×${layout.viewport.height}</div>
<div style="display:flex;gap:16px;align-items:flex-start">${Object.entries(images)
                .map(
                  ([theme, buffer]) =>
                    `<figure style="margin:0"><figcaption style="margin-bottom:4px">${theme}</figcaption><div style="position:relative"><img src="${img(buffer)}" width="${width}" style="display:block">${
                      scene.endsWith('docked')
                        ? `<div style="position:absolute;left:0;right:0;top:${Math.round(layout.viewport.height * 0.55)}px;border-top:2px dashed #d00"></div>`
                        : ''
                    }</div></figure>`,
                )
                .join('')}</div></body>`,
            );
            await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
            await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true });
            await sheet.close();
            shots.push({ file, phase, scene, locale, layout: layout.name, themes: Object.keys(images) });
          }

    // Failure → correction → retry, tapped like a person would (Playwright refuses a tap that a toast would intercept).
    for (const locale of ['en', 'ar']) {
      const layout = layouts[0];
      const file = `retry-after-${locale}-390.webm`;
      const context = await newContext(layout, 'light', { recordVideo: { dir: harness, size: layout.viewport } });
      const { page, errors, consoleErrors, requests } = await open(context, { phase: 'after', locale, theme: 'light' }, failures.network);
      const pause = () => page.waitForTimeout(800);
      const steps = [];
      const note = async (step) => steps.push({ step, ...(await geometry(page)), value: await ga4(page).inputValue() });
      await pause();
      await ga4(page).tap();
      await ga4(page).fill('');
      await ga4(page).pressSequentially('G-7N3P5R8', { delay: 60 });
      await note('edited the GA4 id; the save bar shows');
      await saveButton(page, locale).tap({ timeout: 3000 });
      await page.locator('[data-sonner-toast][data-type="error"]').waitFor();
      await pause();
      await note('tapped Save: the request failed; the error shows and the edit is kept');
      await ga4(page).tap();
      await ga4(page).press('End');
      await ga4(page).pressSequentially('T2V', { delay: 80 });
      await note('corrected the id with the error still showing');
      await saveButton(page, locale).tap({ timeout: 3000 });
      await bar(page).waitFor({ state: 'detached' });
      await pause();
      await note('tapped Save again: saved, the bar hides');
      await pause();
      assert.deepEqual(errors, []);
      assert.deepEqual(consoleErrors, []);
      assert.deepEqual(
        requests.map((request) => request.answer),
        ['network', 200],
      );
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, locale, layout: layout.name, theme: 'light', requests: requests.map((request) => request.answer), steps });
    }

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture in headless Chromium: the real AppProviders (Sonner toast host), SaveRegion and Site settings → Analytics form with the real design system and EN/AR catalogs, in a stand-in dashboard frame; fictional site; the config PATCH answered by interception (network failure, 409, 500, then success); touch emulated for phone layouts; on-screen keyboard simulated by overriding visualViewport.height; not the signed-in dashboard, not production, not a physical phone',
      baseline,
      head: git('rev-parse', 'HEAD'),
      pr703: has703 ? pr703 : 'unavailable',
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: ['apps/app/src/components/app-providers.tsx'],
      attempted: attempted.length,
      shots,
      measurements,
      recordings,
    });
  });
  console.log(`${measurements.length} measurements, ${shots.length} sheets, ${recordings.length} recordings; no page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
