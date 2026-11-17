// Local-only component evidence for #855. Real GitTab, query, direct rotation command and providers;
// HTTP persistence is fictional and intercepted. No app server, database, provider or real key is used.
// Master schedules this after the heavy phase; it acquires the canonical devstack lock separately.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { freemem } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const origin = 'http://settings-secret-once.fixture.test';
const SECRET = 'fictional-one-time-855';
const SITE = 'fictional-site-855';
const catalogs = Object.fromEntries(
  await Promise.all(
    ['en', 'ar'].map(async (locale) => [locale, JSON.parse(await readFile(resolve(root, `packages/i18n/messages/${locale}.json`), 'utf8'))]),
  ),
);
const message = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
assert.ok(freemem() >= 5 * 1024 ** 3, '5 GiB free RAM required before capture');
const devstack = await acquireDevstackLock('ui/855-builder component-only #855');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.settings-secret-once-'));
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-git";\n@source "../src/components";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(resolve(harness, 'git-workflow-stub.tsx'), 'export const GitWorkflow = () => null;');
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { dehydrate, QueryClientProvider } from '@tanstack/react-query';
import { createRoot } from 'react-dom/client';
import { GitTab } from '@/components/settings/git-tab';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
await setLanguage(locale);
document.documentElement.classList.add(theme);
const client = createQueryClient();
const retainedStrings = (value: unknown, seen = new Set<unknown>()): string => {
  if (typeof value === 'string') return value;
  if (!value || (typeof value !== 'object' && typeof value !== 'function') || seen.has(value)) return '';
  seen.add(value);
  const entries = value instanceof Map ? [...value.entries()].flat() : value instanceof Set ? [...value] : [];
  return [...entries, ...Reflect.ownKeys(value).flatMap(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && 'value' in descriptor ? [descriptor.value] : [];
  })].map(item => retainedStrings(item, seen)).join('\\n');
};
(window as any).retention = () => ({
  mutations: client.getMutationCache().getAll().length,
  containsCredential: [client.getQueryCache().getAll(), client.getMutationCache().getAll(), dehydrate(client), dehydrate(client, { shouldDehydrateQuery: () => true, shouldDehydrateMutation: () => true })].some(value => retainedStrings(value).includes('${SECRET}')),
});
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><ConfirmProvider><DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}><main className="mx-auto w-full max-w-3xl p-4 text-foreground sm:p-8"><GitTab key="fixture" projectId="${SITE}" /></main></DirectionProvider><Toaster theme={theme} /></ConfirmProvider></QueryClientProvider>);
`,
  );
  const { build } = await fromApp('vite');
  assert.ok(freemem() >= 5 * 1024 ** 3, '5 GiB free RAM required before fixture build');
  await build({
    configFile: false,
    root: harness,
    logLevel: 'error',
    resolve: { alias: [{ find: /^@\//, replacement: `${resolve(app, 'src')}/` }] },
    plugins: [
      {
        name: 'client-api-origin',
        enforce: 'pre',
        resolveId: (source, importer) =>
          source === './api-origin' && importer?.replaceAll('\\', '/').endsWith('/src/services/api.ts') ? '\0client-api-origin' : undefined,
        load: (id) => (id === '\0client-api-origin' ? 'export const apiOrigin = () => window.location.origin;' : undefined),
      },
      {
        name: 'git-workflow-stub',
        enforce: 'pre',
        resolveId: (source, importer) =>
          /git-workflow$/.test(source) && /\/git-tab\.tsx$/.test(importer?.replaceAll('\\', '/') ?? '')
            ? resolve(harness, 'git-workflow-stub.tsx')
            : undefined,
      },
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };
  const evidence = [];
  assert.ok(freemem() >= 5 * 1024 ** 3, '5 GiB free RAM required before browser launch');
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const width of [390, 1440])
      for (const locale of ['en', 'ar'])
        for (const theme of ['light', 'dark']) {
          const record = width === 1440 && locale === 'en' && theme === 'light';
          const context = await browser.newContext({
            viewport: { width, height: 1000 },
            colorScheme: theme,
            reducedMotion: 'reduce',
            ...(record ? { recordVideo: { dir: resolve(harness, 'video'), size: { width, height: 1000 } } } : {}),
          });
          await context.addInitScript(() => {
            // Test clipboard records counts only; the copied fixture credential is never kept.
            Object.defineProperty(navigator, 'clipboard', {
              value: {
                writeText: async (text) => {
                  window.copyCount = (window.copyCount ?? 0) + 1;
                  window.copiedOneTime = text === 'fictional-one-time-855';
                },
              },
            });
            // Label the displayed fixture in every recorded frame, preserving the application's real React state.
            const label = () => {
              for (const input of document.querySelectorAll('input'))
                input.value = input.value.replaceAll('fictional-one-time-855', '<credential#1>').replaceAll('fictional-site-855', '<site#1>');
              requestAnimationFrame(label);
            };
            requestAnimationFrame(label);
          });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          let held;
          let posts = 0;
          await page.route(`${origin}/**`, async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            const path = `/api/app/projects/${SITE}/`;
            if (url.pathname === `${path}settings` && request.method() === 'GET')
              return route.fulfill({
                json: {
                  data: {
                    plan: 'free',
                    notifications: {},
                    integrations: {},
                    git: {
                      connected: true,
                      provider: 'gitlab',
                      repo: 'fictional/handbook',
                      branch: 'main',
                      path: 'docs',
                      autoPublish: false,
                      webhookConfigured: true,
                    },
                  },
                },
              });
            if (url.pathname === `${path}settings/git/webhook-secret` && request.method() === 'POST') {
              posts += 1;
              assert.equal(request.postData(), null);
              return new Promise((done) => {
                held = async () => {
                  await route.fulfill({ json: { data: { webhookSecret: SECRET } } });
                  done();
                };
              });
            }
            if (url.pathname === `${path}git`) return route.fulfill({ json: { data: null } });
            if (url.pathname.startsWith(path) && request.method() === 'GET') return route.fulfill({ json: { data: [] } });
            assert.ok(!url.pathname.startsWith('/api/'), 'unexpected fixture API');
            const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
            assert.ok(file.startsWith(`${dist}${sep}`));
            return route.fulfill({ body: await readFile(file), contentType: types[extname(file)] ?? 'application/octet-stream' });
          });
          await page.goto(`${origin}/?locale=${locale}&theme=${theme}`);
          await page.locator('#git-webhook-url').waitFor();
          const rotate = page.getByRole('button', { name: message(locale, 'settings.git.webhook.rotate'), exact: true });
          const section = page.locator('li:has(#git-webhook-url)');
          const states = [];
          const screenshots = [];
          const note = async (name) => {
            await section.scrollIntoViewIfNeeded();
            await page.waitForTimeout(250);
            // Let the real toast expire so phone screenshots leave the one-time instructions readable.
            if (name.startsWith('One-time')) await page.waitForFunction(() => !document.querySelector('[data-sonner-toast]'));
            const retained = await page.evaluate(() => window.retention());
            assert.deepEqual(retained, { mutations: 0, containsCredential: false });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
            assert.equal(await page.evaluate(() => document.documentElement.dir), locale === 'ar' ? 'rtl' : 'ltr');
            states.push({ name, secretField: await page.locator('#git-webhook-secret').count(), retained, posts });
            screenshots.push({ name, png: await section.screenshot({ animations: 'disabled' }) });
          };
          assert.equal(await page.locator('#git-webhook-secret').count(), 0);
          await note('Configured: Rotate, with no reveal path');
          await rotate.click();
          await page.waitForFunction(() => document.querySelector('button[aria-busy="true"]'));
          assert.equal(posts, 1);
          await note('Rotation request held');
          await held();
          await page.locator('#git-webhook-secret').waitFor();
          await page.waitForFunction(() => !document.querySelector('button[aria-busy="true"]'));
          await note('One-time answer after original-site settings readback');
          const copy = page.getByRole('button', { name: message(locale, 'settings.git.webhook.copy'), exact: true }).last();
          await copy.focus();
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => window.copiedOneTime === true);
          assert.equal(await copy.evaluate((element) => element === document.activeElement), true, 'copy retains keyboard focus');
          // Hide/reveal are available only while this panel owns its answer.
          await page.getByRole('button', { name: message(locale, 'settings.git.webhook.hide'), exact: true }).click();
          assert.equal(await page.locator('#git-webhook-secret').getAttribute('data-masked'), '');
          await page.getByRole('button', { name: message(locale, 'settings.git.webhook.reveal'), exact: true }).click();
          await page.waitForTimeout(500);
          await page.reload();
          await page.locator('#git-webhook-url').waitFor();
          assert.equal(await page.locator('#git-webhook-secret').count(), 0);
          assert.equal(await rotate.count(), 1);
          assert.equal(posts, 1, 'reload does not rotate');
          await note('Reload: configured, no secret or persistent reveal');
          assert.deepEqual(errors, []);
          const video = page.video();
          await context.close();
          if (record) await video.saveAs(resolve(import.meta.dirname, 'one-time-reveal-copy-reload.webm'));
          const sheet = await browser.newContext({ viewport: { width: width === 390 ? 820 : 1500, height: 800 } });
          const sheetPage = await sheet.newPage();
          await sheetPage.setContent(
            `<html><body style="margin:0;padding:16px;background:${theme === 'dark' ? '#151515' : '#f5f5f5'};color:${theme === 'dark' ? '#eee' : '#111'};font:16px sans-serif"><h1>#855 ${locale.toUpperCase()} ${width}px ${theme}</h1><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${screenshots.map(({ name, png }) => `<section><p>${name}</p><img style="max-width:100%;display:block" src="data:image/png;base64,${png.toString('base64')}"></section>`).join('')}</div></body></html>`,
          );
          await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
          const file = `${locale}-${width}-${theme}.png`;
          await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true });
          await sheet.close();
          evidence.push({ file, locale, width, theme, keyboardCopy: true, focusPreserved: true, pageErrors: errors, states });
        }
    assert.equal(attempted.length, 0);
    await writeFile(
      resolve(import.meta.dirname, 'evidence.json'),
      JSON.stringify(
        {
          baseline: 'c3285e6c2de544aa251b627924f513758be0815d',
          head: git('rev-parse', 'HEAD'),
          sourceSha256: Object.fromEntries(
            await Promise.all(
              [
                'apps/app/src/components/settings/git-tab.tsx',
                'apps/app/src/features/site-git/api/git-settings-webhook-rotate.ts',
                'apps/app/src/features/site-git/components/use-git-settings-webhook-rotate-command.ts',
                'apps/app/src/hooks/api/query-options.ts',
                'apps/app/src/hooks/api/workspace-settings-response.ts',
                'packages/i18n/messages/en.json',
                'packages/i18n/messages/ar.json',
              ].map(async (path) => [
                path,
                createHash('sha256')
                  .update(await readFile(resolve(root, path)))
                  .digest('hex'),
              ]),
            ),
          ),
          dirtySource: git('status', '--porcelain', '--', 'apps/app/src', 'packages/i18n'),
          environment:
            'Local-only component harness; real product components/query/command; intercepted fictional HTTP; no server/DB/provider/production acceptance',
          attemptedNonlocal: attempted.length,
          recordings: ['one-time-reveal-copy-reload.webm'],
          evidence,
        },
        null,
        2,
      ),
    );
  });
  console.log('8 EN/AR light/dark sheets, one reveal/copy/reload recording; zero nonlocal attempts');
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
  await devstack.release();
}
