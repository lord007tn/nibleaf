// Real publish dialog, hooks, router and catalogs with fictional HTTP fixtures.
// The editor destination is a fixture receipt of the real Link's URL, not the
// production editor. No server, publish, provider or database is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const output = import.meta.dirname;
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
const origin = 'http://publish-versions.fixture.test';
assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK, 'Set NIBLEAF_DEVSTACK_LOCK to the owner-provided shared dev-stack directory');
const lock = await acquireDevstackLock('ui/623-versions captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.publish-versions-capture-'));
  for (const component of ['publish-checks', 'publish-modal']) {
    const source = git('show', `${baseline}:apps/app/src/components/project/${component}.tsx`)
      .replace("from './publish-checks'", "from './before-publish-checks'")
      .replace("from './redirect-issue'", "from '@/components/project/redirect-issue'");
    await writeFile(resolve(harness, `before-${component}.tsx`), source);
  }
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Publish version labels fixture</title></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/components/project";\n@source "../../../packages/design-system/src";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, RouterProvider, Outlet } from '@tanstack/react-router';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PublishModal as After } from '@/components/project/publish-modal';
import { PublishModal as Before } from './before-publish-modal';
const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add(params.get('theme') === 'dark' ? 'dark' : 'light');
const Modal = params.get('phase') === 'before' ? Before : After;
const project = { id: 'project-1', name: 'Handbook', slug: 'handbook', readyPublishes: 1, config: {} };
function Publish() {
  const [open, setOpen] = useState(true);
  return <><p className="p-6 text-muted-foreground">Fictional Handbook · Publish fixture</p><Modal project={project as never} open={open} onOpenChange={setOpen} onPublished={() => { throw new Error('Publishing is outside this fixture'); }} /></>;
}
function Receipt() {
  return <main className="mx-auto max-w-xl p-8 text-foreground"><h1 className="mb-4 font-semibold text-xl">Fix navigation receipt (fixture)</h1><p>The real Fix link navigated to:</p><pre data-receipt="" className="mt-4 whitespace-pre-wrap break-all rounded border p-4">{location.pathname + location.search}</pre><p className="mt-4 text-muted-foreground">The production editor is outside this capture.</p></main>;
}
const root = createRootRoute({ component: () => <Outlet /> });
const publish = createRoute({ getParentRoute: () => root, path: '/', component: Publish });
const editor = createRoute({ getParentRoute: () => root, path: '/app/projects/$projectId/editor', component: Receipt, validateSearch: (s) => s });
const router = createRouter({ routeTree: root.addChildren([publish, editor]) });
const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60000, refetchOnWindowFocus: false } } });
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
`,
  );
  const { build } = await fromApp('vite');
  await build({
    configFile: false,
    root: harness,
    logLevel: 'error',
    define: {
      'import.meta.env.VITE_APP_URL': JSON.stringify('http://localhost:4310'),
      'import.meta.env.VITE_SITE_BASE_DOMAIN': JSON.stringify('docs.example.test'),
    },
    resolve: { alias: [{ find: /^@\//, replacement: `${resolve(app, 'src')}/` }] },
    plugins: [
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
      {
        name: 'capture-client-origins',
        enforce: 'pre',
        load(file) {
          const path = file.replaceAll('\\', '/');
          if (path.endsWith('/src/services/api-origin.ts')) return 'export const apiOrigin = () => window.location.origin;';
          if (path.endsWith('/src/lib/site-origin.ts')) return 'export const customDomainOrigin = () => undefined;';
          if (path.endsWith('/src/functions/site-search.ts'))
            return 'export const searchSiteFn = () => { throw new Error("Reader search is outside this fixture"); };';
        },
      },
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
  const results = [];
  await withLocalOnlyBrowser(
    { allowedHosts: [hostKey(origin), 'localhost:4310', 'localhost:4410'], customDomains: { 'publish-versions.fixture.test': 4310 } },
    async ({ browser, attempted }) => {
      for (const phase of ['before', 'after'])
        for (const locale of ['en', 'ar'])
          for (const width of [390, 1440])
            for (const theme of ['light', 'dark']) {
              const recording = phase === 'after' && locale === 'en' && width === 1440 && theme === 'light';
              const context = await browser.newContext({
                viewport: { width, height: width === 390 ? 844 : 1000 },
                locale,
                reducedMotion: 'reduce',
                ...(recording ? { recordVideo: { dir: resolve(harness, 'video'), size: { width, height: 1000 } } } : {}),
              });
              const page = await context.newPage();
              const errors = [];
              const requests = [];
              page.on('pageerror', (error) => errors.push(error.message));
              const versions = [
                { id: 'v1', name: 'Stable مستقر' },
                { id: 'v2', name: 'Next تجريبي' },
              ];
              const checks = versions.map(({ id }, index) => ({
                code: 'broken-internal-link',
                severity: 'error',
                pageId: `page-${index + 1}`,
                versionId: id,
                languageCode: 'en',
                title: 'Guide',
                path: 'guide',
                detail: '/gone?x=1&y=2#intro',
              }));
              await page.route(`${origin}/**`, async (route) => {
                const request = route.request();
                const { pathname } = new URL(request.url());
                if (pathname.startsWith('/api/')) {
                  requests.push(`${request.method()} ${pathname}`);
                  assert.equal(request.method(), 'GET', 'captures cannot write');
                  let body;
                  if (pathname === '/api/auth/get-session')
                    body = {
                      session: { id: 'session-1', userId: 'user-1', expiresAt: '2027-01-01T00:00:00.000Z' },
                      user: { id: 'user-1', name: 'Demo', email: 'demo@example.test', emailVerified: true },
                    };
                  else if (pathname.endsWith('/branches')) body = { data: versions };
                  else if (pathname.endsWith('/members')) body = { data: { members: [{ user: { id: 'user-1' }, role: 'admin' }] } };
                  else if (pathname.endsWith('/domains')) body = { data: [] };
                  else if (pathname.endsWith('/deployments/changes'))
                    body = {
                      data: {
                        hasBaseline: true,
                        lastVersion: 3,
                        lastPublishedAt: '2026-11-01T00:00:00.000Z',
                        upToDate: false,
                        reviewedStateHash: 'fixture-hash',
                        changes: [],
                        redirectIssues: [],
                        checks,
                      },
                    };
                  else throw new Error(`Unexpected API ${pathname}`);
                  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
                }
                const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
                assert.ok(file.startsWith(`${dist}${sep}`));
                return route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
              });
              await page.goto(`${origin}/?phase=${phase}&locale=${locale}&theme=${theme}`);
              const fixes = page.locator('[data-testid="publish-checks"] a');
              await fixes.first().waitFor();
              assert.equal(await fixes.count(), 2);
              if (phase === 'after') await fixes.locator('bdi').first().waitFor();
              await page.evaluate(() => document.fonts.ready);
              // Measure the settled sheet, after its off-screen opening transition.
              await page.waitForFunction(
                () =>
                  !document
                    .getAnimations()
                    .some((animation) => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY),
              );
              const links = await fixes.evaluateAll((nodes) =>
                nodes.map((node) => ({
                  text: node.textContent,
                  name: node.getAttribute('aria-label'),
                  href: node.getAttribute('href'),
                  version: node.querySelector('bdi')?.textContent,
                })),
              );
              assert.equal(new Set(links.map((link) => link.name)).size, phase === 'after' ? 2 : 1);
              if (phase === 'after') {
                assert.equal(new Set(links.map((link) => link.text)).size, 2);
                assert.equal(requests.filter((request) => request.endsWith('/branches')).length, 1);
              }
              const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
              assert.equal(overflow, false, `${phase}-${locale}-${width}-${theme}: horizontal overflow`);
              const screenshot = `${phase}-${locale}-${width}-${theme}.png`;
              await page.screenshot({ path: resolve(output, screenshot), fullPage: true });
              if (recording) {
                await page.waitForTimeout(1000); // Viewer time before Fix navigation.
                await fixes.nth(1).click();
                await page.locator('[data-receipt]').waitFor();
                const url = new URL(page.url());
                assert.equal(url.pathname, '/app/projects/project-1/editor');
                assert.equal(url.searchParams.get('page'), 'page-2');
                assert.equal(url.searchParams.get('fix'), 'broken-internal-link');
                assert.equal(url.searchParams.get('fixTarget'), '/gone?x=1&y=2#intro');
                assert.equal(await page.locator('[role="dialog"]').count(), 0);
                await page.waitForTimeout(1000); // Viewer time on the destination receipt.
              }
              assert.deepEqual(errors, []);
              results.push({ phase, locale, width, theme, screenshot, links, requests, overflow, errors });
              const video = page.video();
              await context.close();
              if (recording) await video.saveAs(resolve(output, 'fix-navigation.webm'));
            }
      assert.deepEqual(attempted, []);
      await writeFile(
        resolve(output, 'evidence.json'),
        `${JSON.stringify({ baseline, nonLocalAttempts: attempted.length, limits: 'Isolated real publish modal and real query/router hooks. Fictional API responses. Editor destination is a URL receipt fixture; no production editor runtime or publish.', results }, null, 2)}\n`,
      );
    },
  );
} finally {
  if (harness) await rm(harness, { recursive: true, force: true });
  await lock.release();
}
