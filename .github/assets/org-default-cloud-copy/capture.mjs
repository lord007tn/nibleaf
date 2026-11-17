// Isolated copy specimens using the real Alert component and starter-name model.
// These are not signed-in dashboard or production captures. No server is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = '94c50b9b068e846c9bec711bc46c6d07a563a750';
const copy = {};
for (const locale of ['en', 'ar']) {
  const file = `packages/i18n/messages/${locale}.json`;
  copy[locale] = { before: JSON.parse(git('show', `${baseline}:${file}`)), after: JSON.parse(await readFile(resolve(root, file), 'utf8')) };
}
const origin = 'http://copy.fixture.test';
const lock = await acquireDevstackLock('organization default and Cloud support copy');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.copy-capture-'));
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'styles.css'), '@import "@nibleaf/design-system/globals.css";\n@source "./main.tsx";');
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { createRoot } from 'react-dom/client';
import { Alert, AlertDescription } from '@nibleaf/design-system/components/ui/alert';
import { starterOrganizationName } from '../../../packages/auth/src/starter-organization';
const data = ${JSON.stringify(copy)};
const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
const phase = params.get('phase') === 'before' ? 'before' : 'after';
document.documentElement.lang = locale;
document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
document.documentElement.classList.add('light');
const catalog = data[locale][phase];
const name = phase === 'before' ? "Demo's workspace" : starterOrganizationName('Demo Writer', locale);
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-3xl space-y-6 p-6 text-foreground">
  <section className="space-y-2"><h1 className="font-semibold text-xl">{catalog.organization_create_name}</h1><p className="rounded-lg border bg-card p-4"><bdi>{name}</bdi></p></section>
  <section className="space-y-3"><h2 className="font-semibold text-xl">{catalog.dashboard_ai_title}</h2>
    <Alert variant="info"><AlertDescription>{catalog.dashboard_ai_captureinstance}</AlertDescription></Alert>
    <Alert variant="info"><AlertDescription>{catalog.dashboard_ai_disabled}</AlertDescription></Alert>
  </section>
</main>);
`,
  );
  const { build } = await fromApp('vite');
  await build({
    configFile: false,
    root: harness,
    logLevel: 'error',
    plugins: [(await fromApp('@vitejs/plugin-react')).default(), (await fromApp('@tailwindcss/vite')).default()],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  const captures = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const locale of ['en', 'ar'])
      for (const phase of ['before', 'after'])
        for (const width of [1440, 390]) {
          const context = await browser.newContext({ viewport: { width, height: 720 }, reducedMotion: 'reduce' });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.route(`${origin}/**`, async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
            assert.ok(file.startsWith(`${dist}${sep}`));
            const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };
            await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
          });
          await page.goto(`${origin}/?locale=${locale}&phase=${phase}`);
          await page.locator('[data-slot="alert"]').first().waitFor();
          await page.evaluate(() => document.fonts.ready);
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
          assert.equal(overflow, false);
          assert.deepEqual(errors, []);
          const file = `${phase}-${locale}-${width}.png`;
          await page.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, animations: 'disabled' });
          captures.push({ file, locale, phase, width, errors, overflow });
          await context.close();
        }
    assert.equal(attempted.length, 0);
    await writeFile(
      resolve(import.meta.dirname, 'evidence.json'),
      `${JSON.stringify({ environment: 'Isolated copy specimens: real Alert component and starterOrganizationName; not the full dashboard or production', baseline, head: git('rev-parse', 'HEAD'), uncommitted: git('status', '--porcelain'), attempted: attempted.length, captures }, null, 2)}\n`,
    );
  });
  console.log(`${captures.length} copy captures; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
