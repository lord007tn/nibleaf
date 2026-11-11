// Real design-system dialog and warning; fictional API data, no database or
// signed-in product session. Before = the existing confirmation without the
// new content slot. Requires the shared dev-stack lock to be owned by this task.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

const root = resolve(import.meta.dirname, '../../..');
const appRequire = createRequire(resolve(root, 'apps/app/package.json'));
const fromApp = async (name) => (await import(pathToFileURL(appRequire.resolve(name)).href)).default;
const output = resolve(root, '.github/assets/feat-delete-inbound-links');
const owner = await readFile('C:/Users/raedb/.t3/worktrees/nibleaf/editor-devstack.lock/owner.txt', 'utf8');
assert.match(owner, /delete-inbound-links implementation/);
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: false,
  root,
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
      configureServer(instance) {
        instance.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith('/fixture?')) return next();
          res.setHeader('Content-Type', 'text/html');
          void instance
            .transformIndexHtml(
              req.url,
              '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Delete link warning fixture</title></head><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="/apps/app/scripts/delete-inbound-links.fixture.tsx"></script></body></html>',
            )
            .then((html) => res.end(html));
        });
      },
    },
  ],
  resolve: { alias: { '@': resolve(root, 'apps/app/src') }, dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 4398, strictPort: true },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({
    executablePath: `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1248/chrome-win64/chrome.exe`,
    headless: true,
  });
  for (const locale of ['en', 'ar']) {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('pageerror', (error) => console.error(error.message));
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
        return route.fulfill({ json: { data: { total: 8, pages: names.map((title, i) => ({ id: `source-${i}`, title, path: `source-${i}` })) } } });
      });
      const deleteLabel = locale === 'ar' ? 'حذف الصفحة' : 'Delete page';
      const cancelLabel = locale === 'ar' ? 'إلغاء' : 'Cancel';
      for (const before of [true, false]) {
        await page.goto(`http://127.0.0.1:4398/fixture?locale=${locale}&before=${before ? 1 : 0}`);
        await page.getByRole('button', { name: deleteLabel, exact: true }).click({ timeout: 120_000 });
        const dialog = page.getByRole('dialog', { name: deleteLabel });
        await dialog.waitFor();
        if (!before) await dialog.getByRole('link', { name: names[0], exact: true }).waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300); // Measure after the opening animation settles.
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
      // A second open really fetches again. Loading and failure stay dismissible
      // and neither presents a stale count as the current result.
      await page.getByRole('button', { name: cancelLabel, exact: true }).click();
      mode = 'loading';
      await page.getByRole('button', { name: deleteLabel, exact: true }).click();
      const dialog = page.getByRole('dialog', { name: deleteLabel });
      await dialog.locator('[aria-busy="true"]').waitFor();
      assert.equal(await dialog.getByRole('button', { name: deleteLabel, exact: true }).isEnabled(), true);
      assert.equal(await dialog.getByRole('status').count(), 0);
      await page.screenshot({ path: resolve(output, `loading-${locale}-${width}.png`) });
      mode = 'error';
      release();
      await dialog.locator('[aria-busy="true"]').waitFor({ state: 'hidden' });
      assert.equal(await dialog.getByRole('status').count(), 0);
      assert.equal(await dialog.getByRole('button', { name: deleteLabel, exact: true }).isEnabled(), true);
      await page.screenshot({ path: resolve(output, `error-${locale}-${width}.png`) });
      await writeFile(resolve(output, `error-${locale}-${width}.aria.txt`), await dialog.ariaSnapshot());
      await context.close();
      console.log(`${locale} ${width}: warning, accessibility tree, loading, error, focus and target sizes passed`);
    }
  }
} finally {
  await browser?.close();
  await server.close();
}
