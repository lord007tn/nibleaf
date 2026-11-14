// Theme settings for a brand accent that fails AA as text (PUB-006): before
// (BASELINE's theme code, default origin/main) and after, EN/AR x light/dark.
// Built with vite and served by request interception: no dev server, no ports.
//   node tests/integration/theme-contrast/browser.mjs [outputDir]
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const baseline = process.env.BASELINE ?? 'origin/main';
const appDir = resolve(root, 'apps/app');
const appRequire = createRequire(resolve(appDir, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const out = resolve(process.argv[2] ?? resolve(root, '.github/assets/fix-reader-accent-contrast/settings'));
const lock = await acquireDevstackLock(`theme-contrast capture
${root}`);
const origin = 'http://localhost:4310';
await mkdir(out, { recursive: true });
const harness = await mkdtemp(resolve(appDir, '.theme-capture-'));
const mainFiles = {
  'apps/app/src/components/project-settings/theme-section.tsx': execFileSync(
    'git',
    ['show', `${baseline}:apps/app/src/components/project-settings/theme-section.tsx`],
    { cwd: root, encoding: 'utf8' },
  ),
  'packages/shared/src/themes.ts': execFileSync('git', ['show', `${baseline}:packages/shared/src/themes.ts`], { cwd: root, encoding: 'utf8' }),
  'apps/app/src/lib/site-theme.ts': execFileSync('git', ['show', `${baseline}:apps/app/src/lib/site-theme.ts`], { cwd: root, encoding: 'utf8' }),
};
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
try {
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Theme</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'main.tsx'), "import './styles.css';\nimport '../scripts/theme-contrast.fixture.tsx';\n");
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@import "../src/styles.css";\n@source "../src";\n@source "../scripts/theme-contrast.fixture.tsx";\n',
  );
  const { build } = await fromApp('vite');
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
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
            name: 'theme-fixture',
            enforce: 'pre',
            resolveId(source) {
              if (source.startsWith('@nibleaf/')) return appRequire.resolve(source);
            },
            load(file) {
              const path = file.replaceAll('\\', '/');
              if (path.endsWith('/src/services/api-origin.ts')) return 'export const apiOrigin = () => window.location.origin;';
              if (path.endsWith('/src/lib/site-origin.ts')) return 'export const customDomainOrigin = () => undefined;';
              if (path.endsWith('/src/functions/site-search.ts'))
                return 'export const searchSiteFn = () => { throw new Error("not in this fixture"); };';
              if (phase === 'before') for (const [rel, source] of Object.entries(mainFiles)) if (path.endsWith(`/${rel}`)) return source;
            },
          },
        ],
        build: { outDir: dist, emptyOutDir: true, target: 'esnext' },
      });
      for (const locale of ['en', 'ar'])
        for (const theme of ['light', 'dark']) {
          const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.route(`${origin}/**`, async (route) => {
            const url = new URL(route.request().url());
            if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":null}' });
            const file = resolve(dist, url.pathname === '/' ? 'index.html' : url.pathname.slice(1));
            try {
              return route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'application/octet-stream', body: await readFile(file) });
            } catch {
              return route.fulfill({ status: 404, body: '' });
            }
          });
          await page.goto(`${origin}/?locale=${locale}&theme=${theme}`, { waitUntil: 'load' });
          await page.waitForSelector('input[type="color"]', { timeout: 60_000 });
          await page.waitForTimeout(800);
          const readout = page.locator('[data-accent-adjustments]');
          const target = (await readout.count()) ? readout : page.locator('input[type="color"]').first();
          await target.scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          const fields = page.locator('input[type="color"]').first().locator('xpath=ancestor::div[contains(@class,"grid")][1]');
          const box = await fields.boundingBox();
          await page.screenshot({
            path: resolve(out, `${phase}-${locale}-${theme}.png`),
            clip: box ? { x: 0, y: Math.max(0, box.y - 40), width: 1440, height: Math.min(560, box.height + 260) } : undefined,
          });
          console.log(
            phase,
            locale,
            theme,
            JSON.stringify({
              readout: await readout.count(),
              text: (await readout.textContent().catch(() => null))?.slice(0, 160) ?? null,
              errors: errors.slice(0, 2),
            }),
          );
          await context.close();
        }
    }
    console.log('attempted outside', attempted.length);
  });
} finally {
  await rm(harness, { recursive: true, force: true });
  lock.release();
}
