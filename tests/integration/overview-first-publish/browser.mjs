// One locked session: before/after, EN/AR, 1440/390. Actual UI and query/mutation
// hooks, intercepted fictional HTTP fixtures. No dev server or containers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const appDir = resolve(root, 'apps/app');
const appRequire = createRequire(resolve(appDir, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const output = resolve(root, '.github/assets/fix-overview-first-publish-checklist');
const baseline = process.env.BASELINE ?? '7e7545a10a9dc59fd8ed239dc1fc950058ee4048';
const origin = 'http://localhost:4344';
const id = 'checklist-journey';
const overview = `/app/projects/${id}/`;
const lock = await acquireDevstackLock(`fix/overview-first-publish-checklist\n${root}`);
let browser;
let harness;
try {
  harness = await mkdtemp(resolve(appDir, '.overview-capture-'));
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>First publish journey</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'main.tsx'), "import './styles.css';\nimport '../scripts/overview-first-publish.fixture.tsx';\n");
  const overviewFile = 'apps/app/src/routes/app/projects/$projectId/index.tsx';
  const beforeSource = execFileSync('git', ['show', `${baseline}:${overviewFile}`], { cwd: root, encoding: 'utf8' });
  await writeFile(resolve(harness, 'before.tsx'), beforeSource);
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@import "../src/content-blocks.css";\n@source "../src";\n@source "./before.tsx";\n@source "../scripts/overview-first-publish.fixture.tsx";\n',
  );
  const { build } = await fromApp('vite');
  // Only these hosts are reachable (capture-env.mjs); anything else fails the run.
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)], launch: { headless: true } }, async ({ browser: guarded }) => {
    browser = guarded;
    const evidence = [];
    for (const phase of ['before', 'after']) {
      const dist = resolve(harness, phase);
      await build({
        configFile: false,
        root: harness,
        base: '/',
        logLevel: 'error',
        define: { 'import.meta.env.VITE_SITE_BASE_DOMAIN': JSON.stringify('docs.example.test') },
        resolve: { alias: { '@': resolve(appDir, 'src') } },
        plugins: [
          (await fromApp('@vitejs/plugin-react')).default(),
          (await fromApp('@tailwindcss/vite')).default(),
          {
            name: 'overview-journey',
            enforce: 'pre',
            resolveId(source) {
              if (source.startsWith('@nibleaf/')) return appRequire.resolve(source);
            },
            load(file) {
              // Plain Vite has no Start import-protection transform. Use the
              // browser halves of the origin helpers in the client-only harness.
              if (file.replaceAll('\\', '/').endsWith('/src/services/api-origin.ts')) return 'export const apiOrigin = () => window.location.origin;';
              if (file.replaceAll('\\', '/').endsWith('/src/lib/site-origin.ts')) return 'export const customDomainOrigin = () => undefined;';
              // The API barrel also exports public reader search, outside this
              // dashboard journey. Fail if it is unexpectedly invoked.
              if (file.replaceAll('\\', '/').endsWith('/src/functions/site-search.ts'))
                return 'export const searchSiteFn = () => { throw new Error("Reader search is outside this dashboard fixture"); };';
              if (phase === 'before' && file.replaceAll('\\', '/').endsWith(`/${overviewFile}`)) return beforeSource;
            },
          },
        ],
        build: { outDir: dist, emptyOutDir: true, target: 'esnext' },
      });
      for (const locale of ['en', 'ar'])
        for (const width of [1440, 390]) {
          const context = await browser.newContext({
            viewport: { width, height: width === 390 ? 844 : 1000 },
            isMobile: width === 390,
            hasTouch: width === 390,
            reducedMotion: 'reduce',
            permissions: ['clipboard-read', 'clipboard-write'],
          });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          const catalog = JSON.parse(await readFile(resolve(root, `packages/i18n/messages/${locale}.json`), 'utf8'));
          const starter = catalog.newsite_starter_welcome_content;
          let saved = starter;
          let domains = [];
          const date = '2026-11-12T00:00:00.000Z';
          const project = {
            id,
            name: locale === 'ar' ? 'دليل الفريق' : 'Team guide',
            slug: 'team-guide',
            readyPublishes: 0,
            hasPublishedVersion: false,
            config: {},
            languages: [],
          };
          const pageRow = (pageId = 'welcome') => ({
            id: pageId,
            projectId: id,
            languageId: 'en',
            parentId: null,
            kind: 'PAGE',
            title: pageId === 'welcome' ? catalog.newsite_starter_welcome_title : catalog.newsite_starter_gettingstarted_title,
            slug: pageId,
            path: pageId,
            updatedAt: date,
            createdAt: date,
            content: pageId === 'welcome' ? saved : catalog.newsite_starter_gettingstarted_content,
            position: 0,
            hidden: false,
            config: null,
            description: null,
          });
          const requests = [];
          await page.route(`${origin}/**`, async (route) => {
            const request = route.request();
            const pathname = new URL(request.url()).pathname;
            if (pathname.startsWith('/api/')) {
              requests.push(`${request.method()} ${pathname}`);
              let data;
              if (pathname === '/api/auth/get-session')
                return route.fulfill({
                  json: {
                    session: { id: 'fixture', userId: 'owner', expiresAt: '2099-01-01T00:00:00.000Z' },
                    user: { id: 'owner', name: 'Site owner', email: 'owner@example.test', emailVerified: true, createdAt: date, updatedAt: date },
                  },
                });
              if (pathname === `/api/app/projects/${id}`) data = project;
              else if (pathname.endsWith('/members'))
                data = { members: [{ id: 'member', role: 'owner', user: { id: 'owner', name: 'Site owner' } }], invitations: [] };
              else if (pathname.endsWith('/pages/welcome')) {
                if (request.method() === 'PATCH') saved = request.postDataJSON().content;
                data = pageRow();
              } else if (pathname.endsWith('/pages'))
                data = [pageRow(), pageRow('getting-started')].map(({ content: _content, ...metadata }) => metadata);
              else if (pathname.endsWith('/domains')) {
                if (request.method() === 'POST')
                  domains = [
                    {
                      id: 'domain',
                      projectId: id,
                      domain: request.postDataJSON().domain,
                      verified: false,
                      isPrimary: false,
                      dnsStatus: 'PENDING',
                      sslStatus: 'PENDING',
                      createdAt: date,
                      updatedAt: date,
                      records: [],
                    },
                  ];
                data = request.method() === 'POST' ? domains[0] : domains;
              } else if (pathname.endsWith('/deployments/changes'))
                data = {
                  hasRealContent: saved.trim() !== starter.trim() && saved.trim().length > 0,
                  hasBaseline: false,
                  upToDate: false,
                  changes: [],
                  checks: [],
                  redirectIssues: [],
                  reviewedStateHash: 'fictional-draft',
                };
              else if (pathname.endsWith('/deployments')) data = [];
              else if (pathname.endsWith('/analytics')) data = { availability: 'available', totalViews: 0, timeseries: [] };
              else throw new Error(`Unexpected fixture request: ${request.method()} ${pathname}`);
              return route.fulfill({ json: { data } });
            }
            const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
            assert.ok(file.startsWith(`${dist}${sep}`));
            await route.fulfill({
              body: await readFile(file),
              contentType:
                { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] ??
                'application/octet-stream',
            });
          });
          const name = `${phase}-${locale}-${width}`;
          const frames = [];
          const frame = async (state) => {
            const path = resolve(output, `${name}-${state}.png`);
            await page.screenshot({ path, animations: 'disabled' });
            frames.push(path);
          };
          const heading = () => page.getByRole('heading', { name: project.name, exact: true });
          const count = () => page.locator('[role="status"]').filter({ hasText: locale === 'ar' ? 'أصل 3' : 'of 3 done' });
          await page.goto(`${origin}${overview}?locale=${locale}`);
          await heading().waitFor();
          await page.getByText(catalog.overview_nudge_title, { exact: true }).waitFor();
          if (phase === 'after') {
            await count().waitFor();
            assert.equal(await count().textContent(), locale === 'ar' ? 'اكتمل 0 من أصل 3' : '0 of 3 done');
          }
          await frame('initial');
          if (phase === 'after') {
            await page.getByRole('button', { name: catalog.deploy_copyaddress, exact: true }).click();
            await page.getByText(catalog.settings_apikeys_urlcopied, { exact: true }).waitFor();
            assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'https://team-guide.docs.example.test');
            await frame('copied');
          }
          await page.getByRole('link', { name: catalog.overview_nudge_step1, exact: true }).click();
          const editor = page.locator('.ProseMirror');
          await editor.waitFor();
          await editor.click();
          await page.keyboard.press('Control+End');
          await page.keyboard.press('Enter');
          const savedResponse = page.waitForResponse(
            (response) => response.request().method() === 'PATCH' && response.url().endsWith('/pages/welcome'),
          );
          await page.keyboard.insertText(locale === 'ar' ? 'أنشئ حسابك ثم ادعُ أعضاء فريقك.' : 'Create your account, then invite your team.');
          await savedResponse;
          await frame('editing');
          await page.getByRole('link', { name: catalog.overview_title, exact: true }).first().click();
          await heading().waitFor();
          if (phase === 'after') {
            await page.locator('ol [role="img"]').waitFor();
            assert.equal(await count().textContent(), locale === 'ar' ? 'اكتملت خطوة واحدة من أصل 3' : '1 of 3 done');
            assert.equal(await page.locator('ol li[aria-current="step"]').getByRole('link').getAttribute('aria-label'), catalog.overview_nudge_step2);
          }
          await frame('edited');
          await page.getByRole('link', { name: catalog.overview_nudge_step3, exact: true }).click();
          const domainInput = page.getByPlaceholder('docs.yoursite.com');
          await domainInput.waitFor();
          await domainInput.fill('docs.team.example.test');
          await page.getByRole('button', { name: catalog.settings_domain_add, exact: true }).click();
          await page.getByText('docs.team.example.test', { exact: true }).first().waitFor();
          await frame('domain-form');
          await page.getByRole('link', { name: catalog.overview_title, exact: true }).first().click();
          await heading().waitFor();
          if (phase === 'after') {
            await page.getByText(catalog.overview_nudge_connecting, { exact: true }).waitFor();
            assert.equal(await page.locator('ol [role="img"]').count(), 2);
            assert.equal(await page.locator('ol li[aria-current="step"]').count(), 1);
            assert.equal(await count().textContent(), locale === 'ar' ? 'اكتملت خطوتان من أصل 3' : '2 of 3 done');
          } else assert.equal(await page.locator('ol [role="img"]').count(), 0);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: no horizontal page overflow`);
          await frame('domain');
          assert.deepEqual(errors, [], `${name}: browser errors`);
          const gif = resolve(output, `${name}.gif`);
          execFileSync('python', [
            '-c',
            'from PIL import Image; import sys; frames=[Image.open(p).convert("RGB") for p in sys.argv[2:]]; frames[0].save(sys.argv[1],save_all=True,append_images=frames[1:],duration=1300,loop=0,optimize=True)',
            gif,
            ...frames,
          ]);
          assert.ok((await stat(gif)).size < 5_000_000, `${name}: GIF under 5 MB`);
          evidence.push({
            phase,
            locale,
            width,
            copy: phase === 'after' ? 'clipboard readback matched' : 'absent on main',
            savedContent: saved.includes(locale === 'ar' ? 'أنشئ حسابك' : 'Create your account'),
            domain: domains[0]?.domain,
            requests,
          });
          await context.close();
          console.log(`${name}: captured`);
        }
    }
    await writeFile(
      resolve(output, 'evidence.json'),
      `${JSON.stringify({ baseline, environment: 'Isolated actual-component fixture; intercepted fictional HTTP; no live DNS or database', journeys: evidence }, null, 2)}\n`,
    );
  });
} finally {
  await browser?.close();
  if (harness) {
    assert.ok(harness.startsWith(`${appDir}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
