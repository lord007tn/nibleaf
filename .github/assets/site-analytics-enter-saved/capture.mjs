// Isolated component fixture of Site settings → Integrations → Analytics:
// the real form (before: the main-branch component; after: this branch) with
// the real save region, design system and EN/AR catalogs, given a fictional
// site. The config PATCH is answered by interception and recorded. Keys are
// trusted CDP key events in headless Chromium, so the browser's own implicit
// submission runs. A fixture readout under the form copies the save region's
// `role="status"` text, which is visually hidden. Not the signed-in dashboard,
// not production, and not a screen-reader test. No server starts.
//
//   node .github/assets/site-analytics-enter-saved/capture.mjs
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
const swapped = 'apps/app/src/features/site-analytics-settings/components/analytics-settings.tsx';
const beforeSource = git('show', `${baseline}:${swapped}`).replaceAll("from '../", "from '@/features/site-analytics-settings/");
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const msg = (locale, key) => catalogs[locale][key.replaceAll('.', '_').toLowerCase()];
const origin = 'http://analytics.fixture.test';
/** The fictional site's saved analytics config. */
const savedAnalytics = { ga4: 'G-4H7K2M9Q1Z', cookieConsent: true };

const lock = await acquireDevstackLock('site analytics Enter captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.analytics-enter-capture-'));
  await writeFile(resolve(harness, 'before-settings.tsx'), `${beforeSource}\n`);
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-analytics-settings";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../src/components/ui";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import { AnalyticsSettings } from '@/features/site-analytics-settings/components/analytics-settings';
import { AnalyticsSettings as BeforeSettings } from './before-settings';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
document.documentElement.classList.add('light');
const project = { id: 'site-1', name: 'Handbook', slug: 'handbook', config: { theme: { preset: 'nib' }, analytics: ${JSON.stringify(savedAnalytics)} } };
const Settings = params.get('phase') === 'before' ? BeforeSettings : AnalyticsSettings;
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const router = createRouter({
  history: createMemoryHistory({ initialEntries: ['/'] }),
  routeTree: createRootRoute({
    component: () => (
      <ConfigDirtyProvider report={() => undefined}>
        <main className="mx-auto w-full max-w-3xl p-4 text-foreground sm:p-8"><Settings project={project as never} /></main>
      </ConfigDirtyProvider>
    ),
  }),
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
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

  /**
   * Opens the fixture. The PATCH is answered after `delay` ms with the merged
   * config, as the API merges it, or refused with a 500 when `fail` is set.
   * Every change to the `role="status"` text is logged in order.
   */
  async function open(context, { phase, locale }, server = {}) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    let held = { ...savedAnalytics };
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      window.__statusLog = [];
      let last = null;
      new MutationObserver(() => {
        const text = document.querySelector('[role="status"]')?.textContent ?? null;
        if (text !== null && text !== last) window.__statusLog.push(text);
        last = text;
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) {
        const body = request.postDataJSON();
        requests.push({ method: request.method(), path: pathname, body });
        assert.equal(`${request.method()} ${pathname}`, 'PATCH /api/app/projects/site-1');
        await new Promise((done) => setTimeout(done, server.delay ?? 0));
        if (server.fail) {
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { message: 'fixture' } }) });
          return;
        }
        held = { ...held, ...body.config.analytics };
        const data = { id: 'site-1', name: 'Handbook', slug: 'handbook', config: { theme: { preset: 'nib' }, analytics: held } };
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
        return;
      }
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&phase=${phase}`);
    await page.locator('[role="switch"]').nth(1).waitFor({ timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests };
  }

  const ga4 = (page) => page.locator('input[placeholder="G-XXXXXXXXXX"]');
  const plausible = (page) => page.locator('input[placeholder="docs.yoursite.com"]');
  const settle = (page, ms = 400) => page.waitForTimeout(ms);
  /** What a reviewer should see after a step: the live status and its history, focus, the bar and the writes so far. */
  const readback = async (page, requests) => ({
    status: await page.evaluate(() => document.querySelector('[role="status"]')?.textContent ?? ''),
    statusLog: await page.evaluate(() => [...window.__statusLog]),
    statusPolite: await page.evaluate(() => document.querySelector('[role="status"]')?.getAttribute('aria-live') ?? null),
    focused: await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return 'body';
      return `${active.tagName.toLowerCase()}[placeholder="${active.getAttribute('placeholder') ?? ''}"]${active.getAttribute('aria-invalid') === 'true' ? '[aria-invalid]' : ''}`;
    }),
    saveBarShown: await page.locator('[data-slot="save-region"]').isVisible(),
    inputs: { ga4: await ga4(page).inputValue(), plausible: await plausible(page).inputValue() },
    requests: [...requests],
    overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  });
  /** Shows, under the form, what the visually hidden status says and what was sent (fixture only). */
  const showReadout = (page, locale, seen) =>
    page.evaluate(
      ({ heading, seen }) => {
        const box = document.createElement('section');
        box.setAttribute('aria-hidden', 'true');
        box.style.cssText =
          'margin:16px auto;max-width:48rem;padding:12px 16px;border:2px dashed #b45309;border-radius:8px;background:#fffbeb;color:#111;font:13px/1.5 ui-monospace,monospace;direction:ltr;text-align:left;overflow-wrap:anywhere';
        const line = (text, bold) => {
          const p = document.createElement('div');
          p.textContent = text;
          if (bold) p.style.fontWeight = '700';
          box.append(p);
        };
        line(heading, true);
        line(`role="status" now: ${JSON.stringify(seen.status)}`);
        line(`role="status" history: ${JSON.stringify(seen.statusLog)}`);
        line(`PATCH requests: ${seen.requests.length}`);
        for (const request of seen.requests) line(`  ${JSON.stringify(request.body.config.analytics)}`);
        line(`focus: ${seen.focused}`);
        document.querySelector('main')?.after(box);
      },
      { heading: `Fixture readout (not part of the page) · ${locale.toUpperCase()}`, seen },
    );

  // Each scene: what the person does by keyboard before the capture.
  const scenes = {
    // Two Enter saves in a row: GA4, then Plausible.
    saved: async (page, requests) => {
      await ga4(page).fill('G-7RJ2KD4P8N');
      await ga4(page).press('Enter');
      await settle(page);
      const first = await readback(page, requests);
      await plausible(page).fill('docs.handbook.example');
      await plausible(page).press('Enter');
      await settle(page);
      return { afterFirstEnter: { status: first.status, requests: first.requests.length } };
    },
    invalid: async (page) => {
      await ga4(page).fill('UA-1234-1');
      await plausible(page).fill('docs.handbook.example');
      await plausible(page).press('Enter');
      await settle(page);
      return {};
    },
  };

  const captures = [];
  const checks = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390])
        for (const [scene, act] of Object.entries(scenes))
          for (const phase of ['before', 'after']) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
            const { page, errors, requests } = await open(context, { phase, locale });
            const observed = await act(page, requests);
            const seen = { ...(await readback(page, requests)), ...observed, pageErrors: errors };
            assert.equal(await page.evaluate(() => document.documentElement.dir), locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(seen.overflow, false);
            assert.deepEqual(errors, []);
            if (scene === 'saved') {
              assert.equal(requests.length, 2);
              assert.deepEqual(
                requests.map((request) => request.body.config.analytics),
                [
                  { ga4: 'G-7RJ2KD4P8N', campaignDimensions: false, storePublicSearchTerms: false },
                  { ga4: 'G-7RJ2KD4P8N', plausible: 'docs.handbook.example', campaignDimensions: false, storePublicSearchTerms: false },
                ],
              );
              const saved = msg(locale, 'common.saved');
              if (phase === 'after') {
                assert.equal(seen.afterFirstEnter.status, saved);
                assert.equal(seen.status, saved);
                // Cleared while the second save ran, then said again.
                assert.deepEqual(seen.statusLog, ['', saved, '', saved]);
              } else {
                assert.equal(seen.status, '');
                assert.deepEqual(seen.statusLog.filter(Boolean), []);
              }
            } else {
              assert.equal(requests.length, 0);
              assert.match(seen.focused, /G-XXXXXXXXXX.*\[aria-invalid\]/);
              if (phase === 'after') assert.equal(seen.status, msg(locale, 'forms.fixHighlighted'));
            }
            await showReadout(page, locale, seen);
            await page.mouse.move(0, 0);
            const file = `enter-${scene}-${phase}-${locale}-${width}.png`;
            await page.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, animations: 'disabled' });
            await context.close();
            const { pageErrors, ...rest } = seen;
            captures.push({ file, phase, scene, locale, width, ...rest, pageErrors });
          }

    // Behaviour checks on this branch: keys that must not save, a refusal, a save in flight, a clean form, Ctrl+S.
    const check = async (name, locale, steps, server) => {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
      const { page, errors, requests } = await open(context, { phase: 'after', locale }, server);
      await steps(page);
      const seen = await readback(page, requests);
      assert.deepEqual(errors, []);
      await context.close();
      const result = { name, locale, ...seen, pageErrors: errors };
      checks.push(result);
      return result;
    };
    for (const locale of ['en', 'ar']) {
      const saved = msg(locale, 'common.saved');
      for (const key of ['Shift+Enter', 'Control+Enter', 'Alt+Enter', 'Meta+Enter']) {
        const seen = await check(`${key} in GA4 does not save`, locale, async (page) => {
          await ga4(page).fill('G-7RJ2KD4P8N');
          await ga4(page).press(key);
          await settle(page);
        });
        assert.equal(seen.requests.length, 0);
        assert.equal(seen.status, '');
        assert.equal(seen.saveBarShown, true);
      }
      const refused = await check(
        'Enter with the server refusing keeps the edit and does not say Saved',
        locale,
        async (page) => {
          await ga4(page).fill('G-7RJ2KD4P8N');
          await ga4(page).press('Enter');
          await settle(page);
        },
        { fail: true },
      );
      assert.equal(refused.requests.length, 1);
      assert.equal(refused.status, '');
      assert.equal(refused.saveBarShown, true);
      const busy = await check(
        'Enter twice during a slow save sends one request; Saved only once it ends',
        locale,
        async (page) => {
          await ga4(page).fill('G-7RJ2KD4P8N');
          await ga4(page).press('Enter');
          await settle(page, 200);
          await ga4(page).press('Enter');
          assert.equal(await page.evaluate(() => document.querySelector('[role="status"]')?.textContent), '');
          await settle(page, 1600);
        },
        { delay: 1200 },
      );
      assert.equal(busy.requests.length, 1);
      assert.equal(busy.status, saved);
      const clean = await check('Enter while clean sends nothing and says nothing', locale, async (page) => {
        await ga4(page).press('Enter');
        await settle(page);
      });
      assert.equal(clean.requests.length, 0);
      assert.equal(clean.status, '');
      const shortcut = await check('Ctrl+S still saves and says Saved', locale, async (page) => {
        await ga4(page).fill('G-7RJ2KD4P8N');
        // The shortcut listens only while the form is dirty, from the next effect on.
        await settle(page, 100);
        await page.keyboard.press('Control+s');
        await settle(page);
      });
      assert.equal(shortcut.requests.length, 1);
      assert.equal(shortcut.status, saved);
    }

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment:
        'Component fixture: the real Analytics form and save region (before: main; after: this branch) with the real design system and EN/AR catalogs; fictional site; the config PATCH answered by interception with a one-level analytics merge like the API; trusted CDP key events in headless Chromium; not the signed-in dashboard, not production, not a screen-reader test',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: [swapped],
      attempted: attempted.length,
      captures,
      checks,
    });
  });
  console.log(`${captures.length} captures and ${checks.length} checks; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
