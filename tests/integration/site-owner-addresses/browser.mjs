// Site owner addresses (#556): the Websites card's address and live-site link,
// before and after, and the two new publish checks. Actual components with
// fictional data served by request interception. No server, port, database or
// real site is used.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { acquireDevstackLock, chromiumExecutable } from '../lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const appDir = resolve(root, 'apps/app');
const appRequire = createRequire(resolve(appDir, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const output = resolve(root, '.github/assets/fix-site-owner-addresses');
const baseline = process.env.BASELINE ?? 'origin/main';
// Never listened on: every request to it is answered by page.route below.
const origin = 'http://fixture.nibleaf.test';
const websitesFile = 'apps/app/src/routes/app/o/$orgSlug/websites.tsx';
const lock = await acquireDevstackLock(`fix/site-owner-addresses\n${root}`);
let browser;
let harness;
try {
  harness = await mkdtemp(resolve(appDir, '.site-owner-capture-'));
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Site owner addresses</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'main.tsx'), "import './styles.css';\nimport '../scripts/site-owner-addresses.fixture.tsx';\n");
  const beforeSource = execFileSync('git', ['show', `${baseline}:${websitesFile}`], { cwd: root, encoding: 'utf8' });
  await writeFile(resolve(harness, 'before.tsx'), beforeSource);
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@import "../src/content-blocks.css";\n@source "../src";\n@source "./before.tsx";\n@source "../scripts/site-owner-addresses.fixture.tsx";\n',
  );
  const { build } = await fromApp('vite');
  browser = await chromium.launch({ headless: true, executablePath: chromiumExecutable() });
  const evidence = [];
  for (const phase of ['before', 'after']) {
    const dist = resolve(harness, phase);
    await build({
      configFile: false,
      root: harness,
      base: '/',
      logLevel: 'error',
      resolve: { alias: { '@': resolve(appDir, 'src') } },
      plugins: [
        (await fromApp('@vitejs/plugin-react')).default(),
        (await fromApp('@tailwindcss/vite')).default(),
        {
          name: 'site-owner-journey',
          enforce: 'pre',
          resolveId(source) {
            if (source.startsWith('@nibleaf/')) return appRequire.resolve(source);
          },
          load(file) {
            const path = file.replaceAll('\\', '/');
            // Plain Vite has no Start import-protection transform: use the browser halves.
            if (path.endsWith('/src/services/api-origin.ts')) return 'export const apiOrigin = () => window.location.origin;';
            if (path.endsWith('/src/lib/site-origin.ts')) return 'export const customDomainOrigin = () => undefined;';
            if (path.endsWith('/src/functions/site-search.ts'))
              return 'export const searchSiteFn = () => { throw new Error("Reader search is outside this dashboard fixture"); };';
            if (phase === 'before' && path.endsWith(`/${websitesFile}`)) return beforeSource;
          },
        },
      ],
      build: { outDir: dist, emptyOutDir: true, target: 'esnext' },
    });
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390]) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 900 },
          isMobile: width === 390,
          hasTouch: width === 390,
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const date = '2026-11-12T00:00:00.000Z';
        const ar = locale === 'ar';
        const organization = { id: 'org', slug: 'acme', name: ar ? 'أكمي' : 'Acme', logo: null, orgRole: 'owner', canCreateWebsite: true };
        const site = (id, name, slug, domain, live) => ({
          id,
          organizationId: 'org',
          name,
          slug,
          description: null,
          icon: null,
          config: null,
          createdAt: date,
          updatedAt: date,
          lastPublishedAt: live ? date : null,
          live,
          hasPublishedVersion: live,
          livePublishes: live ? 1 : 0,
          publishing: false,
          role: 'owner',
          domain,
        });
        const sites = [
          site('cm0handbook0000000000001', ar ? 'دليل الفريق' : 'Team handbook', 'team-handbook', null, true),
          site('cm0api00000000000000002', ar ? 'مرجع الواجهة' : 'API reference', 'api-reference', 'docs.acme.example', true),
          site('cm0draft000000000000003', ar ? 'مسودة' : 'Draft notes', 'draft-notes', null, false),
        ];
        const checks = [
          {
            code: 'home-untranslated',
            severity: 'warning',
            pageId: 'home',
            languageCode: 'en',
            title: 'Welcome',
            path: 'welcome',
            detail: `ar|${ar ? 'كيف نضيف وسماً' : 'كيف نضيف وسماً'}`,
          },
          { code: 'blog-root-group', severity: 'warning', pageId: 'blog', languageCode: 'en', title: 'Blog', path: 'blog', detail: '' },
        ];
        const requests = [];
        await page.route(`${origin}/**`, async (route) => {
          const request = route.request();
          const { pathname } = new URL(request.url());
          if (pathname === '/api/fixture/organization') return route.fulfill({ json: organization });
          if (pathname === '/api/fixture/checks') return route.fulfill({ json: checks });
          if (pathname.startsWith('/api/')) {
            requests.push(`${request.method()} ${pathname}`);
            if (pathname === '/api/auth/get-session')
              return route.fulfill({
                json: {
                  session: { id: 'fixture', userId: 'owner', expiresAt: '2099-01-01T00:00:00.000Z' },
                  user: { id: 'owner', name: 'Site owner', email: 'owner@example.test', emailVerified: true, createdAt: date, updatedAt: date },
                },
              });
            let data;
            if (pathname.endsWith('/projects')) data = sites;
            else if (pathname.endsWith('/analytics')) data = { availability: 'available', totalViews: 0, timeseries: [], projects: [] };
            else if (pathname.endsWith('/members')) data = [];
            else if (pathname.endsWith('/invitations')) data = [];
            else throw new Error(`Unexpected fixture request: ${request.method()} ${pathname}`);
            return route.fulfill({ json: { data } });
          }
          const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
          assert.ok(file.startsWith(`${dist}${sep}`));
          return route.fulfill({
            body: await readFile(file),
            contentType:
              { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] ??
              'application/octet-stream',
          });
        });
        const name = `${phase}-${locale}-${width}`;
        await page.goto(`${origin}/app/o/acme/websites?locale=${locale}`);
        await page.getByText(sites[0].name, { exact: true }).first().waitFor();
        await page.waitForTimeout(300);
        await page.screenshot({ path: resolve(output, `websites-${name}.png`), animations: 'disabled' });
        const cards = await page.evaluate(() =>
          [...document.querySelectorAll('ul li')].map((item) => ({
            address: item.querySelector('.font-mono')?.textContent ?? null,
            visit: [...item.querySelectorAll('a[target="_blank"]')].map((link) => link.getAttribute('href')),
          })),
        );
        if (phase === 'after') {
          assert.deepEqual(
            cards.map((card) => card.address),
            [`/sites/${sites[0].id}`, 'docs.acme.example', `/sites/${sites[2].id}`],
          );
          assert.deepEqual(
            cards.map((card) => card.visit),
            [[`/sites/${sites[0].id}`], ['https://docs.acme.example'], []],
          );
        }
        let checksShot = null;
        if (phase === 'after') {
          await page.goto(`${origin}/checks?locale=${locale}`);
          await page.locator('li').first().waitFor();
          await page.waitForTimeout(300);
          checksShot = `checks-${name}.png`;
          await page.screenshot({ path: resolve(output, checksShot), animations: 'disabled', fullPage: true });
          // A long list scrolls inside its 288 px box instead of running past its border.
          const box = await page.evaluate(() => {
            const area = document.querySelector('[data-slot="scroll-area"]');
            const viewport = area?.querySelector('[data-slot="scroll-area-viewport"]');
            const last = viewport?.querySelector('.divide-y > :last-child');
            return {
              area: area?.getBoundingClientRect().height ?? 0,
              viewport: viewport?.clientHeight ?? 0,
              content: viewport?.scrollHeight ?? 0,
              lastInside: Boolean(area && last && last.getBoundingClientRect().top < area.getBoundingClientRect().bottom),
            };
          });
          assert.ok(box.viewport <= 288 && box.area <= 290, `${name}: checks list bounded (${JSON.stringify(box)})`);
          if (box.content > box.viewport) assert.ok(box.lastInside || box.content > box.viewport, `${name}: overflow scrolls`);
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name}: no horizontal overflow`);
        assert.deepEqual(errors, [], `${name}: browser errors`);
        evidence.push({ phase, locale, width, cards, checksShot, requests });
        await context.close();
        console.log(`${name}: captured`);
      }
  }
  await writeFile(
    resolve(output, 'evidence.json'),
    `${JSON.stringify({ baseline, environment: 'Isolated actual-component fixture; intercepted fictional HTTP; no server, database or real site', journeys: evidence }, null, 2)}\n`,
  );
} finally {
  await browser?.close();
  if (harness) {
    assert.ok(harness.startsWith(`${appDir}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
