// Real design-system dialog and warning; fictional API data, no database or
// signed-in product session. Before = the existing confirmation without the
// new content slot. Like design-system/forced-colors.mjs, this renders a static
// build via Playwright interception: no dev server, container or stack lock.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import { withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const appRequire = createRequire(resolve(root, 'apps/app/package.json'));
const fromApp = async (name) => (await import(pathToFileURL(appRequire.resolve(name)).href)).default;
const output = resolve(root, '.github/assets/feat-delete-inbound-links');
const appDir = resolve(root, 'apps/app');
const harness = await mkdtemp(resolve(appDir, '.inbound-capture-'));
const dist = resolve(harness, 'dist');
await mkdir(output, { recursive: true });
let browser;
try {
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delete link warning fixture</title></head><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'main.tsx'), "import './styles.css';\nimport '../scripts/delete-inbound-links.fixture.tsx';\n");
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "../src";\n@source "../scripts/delete-inbound-links.fixture.tsx";\n',
  );
  await build({
    configFile: false,
    root: harness,
    base: '/',
    logLevel: 'warn',
    plugins: [
      (await fromApp('@vitejs/plugin-react'))(),
      (await fromApp('@tailwindcss/vite'))(),
      {
        name: 'delete-link-fixture',
        enforce: 'pre',
        resolveId(source, importer) {
          if (source === '@nibleaf/i18n/react') return '\0fixture-translator';
          if (source.startsWith('@nibleaf/')) return appRequire.resolve(source);
          if (source === './api-origin' && importer?.replaceAll('\\', '/').endsWith('/services/api.ts')) return '\0fixture-api-origin';
        },
        load(id) {
          if (id === '\0fixture-api-origin') return 'export const apiOrigin = () => window.location.origin;';
          // The real generated messages, restricted to the keys this fixture
          // renders, avoid requesting the entire dashboard catalog in Vite dev.
          if (id === '\0fixture-translator') {
            const keys = {
              'editor.deletePage': 'editor_deletepage',
              'editor.deletePageConfirm': 'editor_deletepageconfirm',
              'editor.deleteInboundLinks': 'editor_deleteinboundlinks',
              'editor.untitled': 'editor_untitled',
              'common.cancel': 'common_cancel',
              'common.loading': 'common_loading',
              'publish.more': 'publish_more',
            };
            return `${Object.values(keys)
              .map((id) => `import { ${id} } from '@nibleaf/i18n/messages/${id}';`)
              .join('\n')}
            const messages = {${Object.entries(keys)
              .map(([key, id]) => `${JSON.stringify(key)}: ${id}`)
              .join(',')}};
            export const useT = () => (key, vars) => messages[key](vars);`;
          }
        },
      },
    ],
    resolve: { alias: { '@': resolve(root, 'apps/app/src') }, dedupe: ['react', 'react-dom'] },
    build: { outDir: dist, emptyOutDir: true },
  });
  // Only these hosts are reachable (capture-env.mjs); anything else fails the run.
  await withLocalOnlyBrowser({ allowedHosts: ['inbound-fixture.test:80'], launch: { headless: true } }, async ({ browser: guarded }) => {
    browser = guarded;
    for (const locale of ['en', 'ar']) {
      for (const width of [1440, 390]) {
        const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'reduce' });
        const page = await context.newPage();
        page.on('pageerror', (error) => console.error(error.message));
        const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
        await page.route('http://inbound-fixture.test/**', async (route) => {
          const pathname = new URL(route.request().url()).pathname;
          const file = resolve(dist, pathname === '/fixture' ? 'index.html' : `.${pathname}`);
          assert.ok(file.startsWith(`${dist}${sep}`), 'fixture assets stay inside the owned build');
          return route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
        });
        let mode = 'success';
        let release;
        const names =
          locale === 'ar'
            ? ['البدء السريع', 'دليل التثبيت', 'إعداد الحساب', 'مرجع الواجهة', 'الأسئلة الشائعة']
            : ['Quick start', 'Installation guide', 'Account setup', 'API reference', 'Frequently asked questions'];
        await page.route('**/api/app/projects/fixture-site/pages/setup/inbound-links', async (route) => {
          if (mode === 'loading')
            await new Promise((resolveWait) => {
              release = resolveWait;
            });
          if (mode === 'error') return route.fulfill({ status: 503, json: { error: { message: 'Fixture unavailable' } } });
          return route.fulfill({
            json: {
              data: {
                total: mode === 'empty' ? 0 : 8,
                pages:
                  mode === 'empty'
                    ? []
                    : names.map((title, i) => ({
                        id: `source-${i}`,
                        title: mode === 'long' ? `${title} `.repeat(8).trim().slice(0, 200) : title,
                        path: `source-${i}`,
                      })),
              },
            },
          });
        });
        const deleteLabel = locale === 'ar' ? 'حذف الصفحة' : 'Delete page';
        const cancelLabel = locale === 'ar' ? 'إلغاء' : 'Cancel';
        const boxes = {};
        const record = async (state) => {
          const dialog = page.getByRole('dialog', { name: deleteLabel });
          const remove = await dialog.getByRole('button', { name: deleteLabel, exact: true }).boundingBox();
          const footer = await dialog.locator('[data-slot="dialog-footer"]').boundingBox();
          assert.ok(remove && footer, 'footer and Delete are visible');
          boxes[state] = { remove, footer };
          if (state !== 'loading')
            for (const element of ['remove', 'footer'])
              for (const coordinate of ['x', 'y', 'width', 'height']) {
                assert.ok(
                  Math.abs(boxes.loading[element][coordinate] - boxes[state][element][coordinate]) <= 0.5,
                  `${state}: stable ${element} ${coordinate}`,
                );
              }
        };
        for (const before of [true, false]) {
          mode = before ? 'success' : 'loading';
          await page.goto(`http://inbound-fixture.test/fixture?locale=${locale}&before=${before ? 1 : 0}`);
          await page.getByRole('button', { name: deleteLabel, exact: true }).click({ timeout: 120_000 });
          const dialog = page.getByRole('dialog', { name: deleteLabel });
          await dialog.waitFor();
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(300); // Measure after the opening animation settles.
          if (!before) {
            await dialog.locator('[aria-busy="true"]').waitFor();
            await record('loading');
            await page.screenshot({ path: resolve(output, `loading-${locale}-${width}.png`) });
            mode = 'success';
            release();
            await dialog.getByRole('link', { name: names[0], exact: true }).waitFor();
            await record('result');
          }
          const snapshot = await dialog.ariaSnapshot();
          assert.match(snapshot, /30/);
          if (!before) {
            assert.match(snapshot, /status:/);
            assert.ok(snapshot.includes(locale === 'ar' ? '8 صفحات ترتبط هنا' : '8 pages link here'), 'localized counted warning');
            for (const title of names) assert.ok(snapshot.includes(`link "${title}"`), title);
            assert.equal(await dialog.getByRole('link').count(), 5);
            assert.equal(await dialog.getByRole('button', { name: cancelLabel, exact: true }).evaluate((el) => el === document.activeElement), true);
            const bounds = await dialog.boundingBox();
            assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'dialog fits viewport');
            for (const link of await dialog.getByRole('link').all()) assert.ok((await link.boundingBox()).height >= 44, '44px link target');
          }
          await page.screenshot({ path: resolve(output, `${before ? 'before' : 'after'}-${locale}-${width}.png`) });
          await writeFile(resolve(output, `${before ? 'before' : 'after'}-${locale}-${width}.aria.txt`), snapshot);
        }
        // Refresh the SAME open dialog: a late result, failure, or empty response
        // must never place Delete under a pointer previously aimed at a link.
        const dialog = page.getByRole('dialog', { name: deleteLabel });
        mode = 'error';
        await page.evaluate(() => window.refetchInboundLinks());
        await dialog.getByRole('status').waitFor({ state: 'hidden' });
        await record('error');
        assert.equal(await dialog.getByRole('status').count(), 0);
        assert.equal(await dialog.getByRole('button', { name: deleteLabel, exact: true }).isEnabled(), true);
        await page.screenshot({ path: resolve(output, `error-${locale}-${width}.png`) });
        await writeFile(resolve(output, `error-${locale}-${width}.aria.txt`), await dialog.ariaSnapshot());
        mode = 'empty';
        await page.evaluate(() => window.refetchInboundLinks());
        await page.waitForFunction(() => document.querySelector('[data-slot="delete-page-advisory"]')?.textContent === '');
        await record('empty');
        await page.screenshot({ path: resolve(output, `empty-${locale}-${width}.png`) });
        mode = 'long';
        await page.evaluate(() => window.refetchInboundLinks());
        await page.waitForFunction(() => {
          const region = document.querySelector('[data-slot="delete-page-advisory"]');
          return region && region.scrollHeight > region.clientHeight;
        });
        await record('long');
        assert.equal(await dialog.locator('[data-slot="delete-page-advisory"]').evaluate((el) => getComputedStyle(el).overflowY), 'auto');
        mode = 'success';
        await page.evaluate(() => window.refetchInboundLinks());
        await dialog.getByRole('link', { name: names[0], exact: true }).waitFor();
        await record('restored');
        await writeFile(resolve(output, `layout-${locale}-${width}.json`), `${JSON.stringify(boxes, null, 2)}\n`);
        await context.close();
        console.log(`${locale} ${width}: stable loading/result/error/empty/long-list boxes, accessibility, focus and target sizes passed`);
      }
    }
  });
} finally {
  await browser?.close();
  assert.equal(dirname(harness), appDir);
  assert.ok(basename(harness).startsWith('.inbound-capture-'));
  await rm(harness, { recursive: true, force: true });
}
