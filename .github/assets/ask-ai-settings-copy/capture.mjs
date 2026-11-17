// Real Ask AI page and design system, with fictional hook data. No API or
// application server: the local-only browser receives the built fixture by interception.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const origin = 'http://localhost:4310';
const out = import.meta.dirname;
assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK, 'Set NIBLEAF_DEVSTACK_LOCK to the shared machine-wide lock directory before capturing');
const lock = await acquireDevstackLock('ui/642-copy component captures');
let fixture;
try {
  fixture = await mkdtemp(resolve(app, '.ask-ai-copy-'));
  await writeFile(
    resolve(fixture, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(fixture, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-ai";\n@source "../src/components/ui";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(fixture, 'hooks.ts'),
    `const mode = new URLSearchParams(location.search).get('state');
const ai = {
  capabilities: {
    managed: { available: true, reason: null, model: { id: 'fixture-model', label: 'Fixture model' }, dailyAnswerLimit: 200 },
    ownKey: { available: true, reason: null },
    providers: [{ id: 'openai', available: true, reason: null }, { id: 'openrouter', available: true, reason: null }],
    answers: { available: mode !== 'unavailable', reason: mode === 'unavailable' ? 'searchNotConfigured' : null },
  },
  status: {
    answersOn: mode === 'ready' || mode === 'error', source: 'managed', sourceReady: true, connections: [],
    published: { version: 12, at: '2026-11-11T08:00:00.000Z' },
    preparation: { state: 'ready', pages: 128, expectedPages: 128, at: '2026-11-11T08:05:00.000Z' },
    usage: { answersToday: 37, spent: mode === 'error' ? 200 : 40, limit: 200, resetsAt: '2026-11-18T00:00:00.000Z' },
  },
  viewer: { canManage: true },
};
export const useSiteAi = () => ({ data: ai, isPending: false, isFetching: false });
export const useSelectAiSource = () => ({ isPending: false, mutate: () => { throw new Error('Capture must not mutate'); } });
export const usePrepareDocsForAi = useSelectAiSource;
export const useProjectAdminStatus = () => ({ status: 'admin' });
export const ProviderKeyForm = () => null;
`,
  );
  await writeFile(
    resolve(fixture, 'main.tsx'),
    `import './styles.css';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { useLocale } from '@nibleaf/i18n/react';
import { createRoot } from 'react-dom/client';
import { createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { AiAnswersPage } from '@/features/site-ai/components/ai-answers-page';
import { sectionLabelKey } from '@/features/site-settings/model/sections';
const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add(params.get('theme') === 'dark' ? 'dark' : 'light');
function Fixture() {
  const { t } = useLocale();
  return <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
    <main className="mx-auto w-full max-w-5xl p-4 sm:p-8">
      <nav aria-label="Fixture settings navigation" className="mb-6 text-sm text-muted-foreground">
        <a href="/?section=ai">{t(sectionLabelKey('ai'))}</a>
      </nav>
      <AiAnswersPage project={{ id: '00000000-0000-4000-8000-000000000642' }} />
    </main>
  </DirectionProvider>;
}
const route = createRootRoute({ component: Fixture });
const router = createRouter({ routeTree: route });
createRoot(document.getElementById('root')!).render(<RouterProvider router={router} />);
`,
  );
  const { build } = await fromApp('vite');
  const dist = resolve(fixture, 'dist');
  await build({
    configFile: false,
    root: fixture,
    logLevel: 'error',
    resolve: { alias: [{ find: /^@\//, replacement: `${resolve(app, 'src')}/` }] },
    plugins: [
      {
        name: 'fictional-ai-data',
        enforce: 'pre',
        resolveId(source, importer) {
          const path = source.replaceAll('\\', '/');
          const parent = importer?.replaceAll('\\', '/');
          if (
            /\/src\/hooks\/use-project-admin-status(\.ts)?$/.test(path) ||
            (parent?.endsWith('/site-ai/components/ai-answers-page.tsx') && ['../api/hooks', './provider-key-form'].includes(path))
          )
            return resolve(fixture, 'hooks.ts');
        },
      },
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: dist, target: 'esnext' },
  });
  const english = JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8'));
  const arabic = JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8'));
  const results = [];
  await withLocalOnlyBrowser({ allowedHosts: ['localhost:4310'], customDomains: {} }, async ({ browser, attempted }) => {
    const context = await browser.newContext();
    const errors = [];
    await context.route(`${origin}/**`, async (route) => {
      const path = new URL(route.request().url()).pathname;
      assert.equal(route.request().method(), 'GET');
      assert.ok(!path.startsWith('/api/'), 'No API calls in this component fixture');
      const file = resolve(dist, path.startsWith('/assets/') ? `.${path}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
      await route.fulfill({ body: await readFile(file), contentType: types[extname(file)] ?? 'application/octet-stream' });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    for (const locale of ['en', 'ar']) {
      const catalog = locale === 'ar' ? arabic : english;
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const theme of ['light', 'dark']) {
          for (const state of ['unavailable', 'off', 'ready', 'error']) {
            await page.goto(`${origin}/?locale=${locale}&theme=${theme}&state=${state}`);
            await page.getByRole('heading', { level: 1, name: catalog.settings_ai, exact: true }).waitFor();
            await page.evaluate(() => document.fonts.ready);
            const text = await page.locator('main').innerText();
            assert.equal(await page.locator('nav').innerText(), catalog.settings_ai);
            assert.ok(!text.includes(locale === 'en' ? 'AI answers' : 'الإجابات الذكية'));
            if (state === 'unavailable') {
              assert.ok(text.includes(catalog.settings_ai_reason_serverunavailable));
              assert.equal(await page.getByRole('switch').count(), 0);
            } else {
              assert.equal(await page.getByRole('switch').getAttribute('aria-checked'), String(state !== 'off'));
              assert.ok(text.includes(catalog.settings_ai_sources_title));
              assert.ok(text.includes(catalog.settings_ai_check_description));
              if (state === 'off') assert.ok(text.includes(catalog.settings_ai_check_source_idle));
              if (state === 'error') {
                assert.ok(text.includes(catalog.settings_ai_notworking_title));
                assert.ok(text.includes(catalog.settings_ai_problem_limitreached.replace('{limit}', '200')));
              }
            }
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
            assert.equal(overflow, false);
            const screenshot = `${locale}-${width}-${theme}-${state}.png`;
            await page.screenshot({ path: resolve(out, screenshot), fullPage: true, animations: 'disabled' });
            results.push({ locale, width, theme, state, screenshot, horizontalOverflow: overflow });
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(attempted, []);
    await writeFile(
      resolve(out, 'evidence.json'),
      `${JSON.stringify(
        {
          base: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
          fixture: 'Real AiAnswersPage and design system; fictional hooks; nav label from sectionLabelKey, not the full dashboard shell',
          nonLocalAttempts: attempted.length,
          pageErrors: errors,
          results,
        },
        null,
        2,
      )}\n`,
    );
    await context.close();
  });
  console.log(`Captured ${results.length} real component states; 0 non-local attempts.`);
} finally {
  try {
    if (fixture) {
      assert.ok(fixture.startsWith(`${app}${sep}`));
      await rm(fixture, { recursive: true, force: true });
    }
  } finally {
    await lock.release();
  }
}
