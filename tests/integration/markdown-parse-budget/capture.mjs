// Screenshots for the Markdown parse budget (#555): the publish dialog's
// warning and a reader page with one block over the budget, in English and
// Arabic, rendered by the app's own components and stylesheet.
//
// It builds a throwaway page (Vite, inside apps/app so workspace packages and
// the `@/` alias resolve), serves it to Chromium from memory through
// capture-env.mjs (no ports, no stack, and every other host is refused), takes
// the shots, and removes the page again:
//   node tests/integration/markdown-parse-budget/capture.mjs <outDir> <before|after>
// `before` is for a checkout whose publish check detail is the bare limit name
// (`nesting`); `after` sends the line and amount (`nesting:9:70:tags`).
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const [outArg, phase = 'after'] = process.argv.slice(2);
assert.ok(outArg, 'usage: capture.mjs <outDir> <before|after>');
assert.ok(phase === 'before' || phase === 'after', 'phase is before or after');
const outDir = resolve(outArg);
const appDir = fileURLToPath(new URL('../../../apps/app/', import.meta.url));
const harness = join(appDir, '.markdown-parse-budget-capture');
const fromApp = (name) => import(pathToFileURL(createRequire(join(appDir, 'package.json')).resolve(name)).href);

rmSync(harness, { recursive: true, force: true });
mkdirSync(harness, { recursive: true });
mkdirSync(outDir, { recursive: true });
writeFileSync(
  join(harness, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>parse budget</title></head><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
);
// TanStack Start's server entry has no place in a static page: its isomorphic
// functions take their client side, as the app's own client bundle does.
writeFileSync(
  join(harness, 'start-stub.ts'),
  `type Fn = (...args: unknown[]) => unknown;
export const createIsomorphicFn = () => {
  let client: Fn = () => undefined;
  const run = (...args: unknown[]) => client(...args);
  return Object.assign(run, { client: (fn: Fn) => ((client = fn), Object.assign(run, { server: () => run })), server: () => run });
};
export const getRequest = () => undefined;
`,
);
writeFileSync(join(harness, 'styles.css'), '@import "../src/styles.css";\n@source "../src";\n@source "../../../packages/design-system/src";\n');
writeFileSync(
  join(harness, 'main.tsx'),
  `import { prepareDashboardLocale } from '@nibleaf/i18n/dashboard-catalog';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { Markdown } from '@/components/markdown';
import { PublishChecks } from '@/components/project/publish-checks';
import './styles.css';

const query = new URLSearchParams(location.search);
const locale = query.get('lang') === 'ar' ? 'ar' : 'en';
const view = query.get('view');
const detail = query.get('detail') ?? '';

// A generated status table pasted into a page: 70 nested elements on one line.
const deep = \`\${'<div>'.repeat(70)}Status table\${'</div>'.repeat(70)}\`;
const PAGES = {
  en: [
    '# Shipment webhooks',
    'Nibleaf sends a webhook each time a shipment changes state. This page lists the events and what each one carries.',
    '## Events',
    '- \`shipment.created\` when a label is bought.\\n- \`shipment.delivered\` when the carrier confirms delivery.',
    deep,
    '## Retries',
    'Failed deliveries are retried with **exponential backoff** for 24 hours. See [Signatures](/signatures) to verify each request.',
  ],
  ar: [
    '# خطافات الشحنات',
    'يرسل Nibleaf خطافًا في كل مرة تتغير فيها حالة شحنة. تسرد هذه الصفحة الأحداث وما يحمله كل منها.',
    '## الأحداث',
    '- \`shipment.created\` عند شراء ملصق الشحن.\\n- \`shipment.delivered\` عندما تؤكد شركة النقل التسليم.',
    deep,
    '## إعادة المحاولة',
    'يُعاد إرسال الطلبات التي فشلت مع **تأخير متزايد** لمدة 24 ساعة. راجع [التواقيع](/signatures) للتحقق من كل طلب.',
  ],
};

const check = (code, pageId, title, checkDetail) => ({ code, severity: 'warning', pageId, languageCode: locale, title, path: pageId, detail: checkDetail });
const checks = [
  check('markdown-parse-limit', 'webhooks', locale === 'ar' ? 'خطافات الشحنات' : 'Shipment webhooks', detail),
  check('missing-alt', 'tracking', locale === 'ar' ? 'تتبّع الشحنات' : 'Tracking', '/images/map.png'),
];

function View() {
  if (view === 'dialog')
    return (
      <div className="w-[440px] p-4" data-capture="dialog">
        <PublishChecks checks={checks} loading={false} onFix={() => undefined} projectId="project-1" />
      </div>
    );
  return (
    <main className="mx-auto max-w-3xl px-8 py-6" data-capture="reader">
      <Markdown content={PAGES[locale].join('\\n\\n')} />
    </main>
  );
}

const rootRoute = createRootRoute({ component: View });
const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/'] }) });
await prepareDashboardLocale(locale);
await setLanguage(locale);
createRoot(document.getElementById('root')).render(<RouterProvider router={router} />);
`,
);

const SHOTS = [
  { name: 'dialog', view: 'dialog', ready: '[data-capture="dialog"] li, [data-capture="dialog"] [role="listitem"], [data-capture="dialog"] a' },
  { name: 'reader', view: 'reader', ready: '[data-capture="reader"] .typeset' },
];
const detail = phase === 'before' ? 'nesting' : 'nesting:9:70:tags';

try {
  await build({
    root: harness,
    base: './',
    logLevel: 'warn',
    configFile: false,
    resolve: {
      alias: [
        { find: /^@tanstack\/react-start(?:\/server)?$/, replacement: join(harness, 'start-stub.ts') },
        { find: /^@\//, replacement: `${join(appDir, 'src').replaceAll('\\', '/')}/` },
      ],
    },
    plugins: [(await fromApp('@tailwindcss/vite')).default(), (await fromApp('@vitejs/plugin-react')).default()],
    build: { outDir: join(harness, 'dist'), emptyOutDir: true, target: 'es2022' },
  });

  const attempts = await withLocalOnlyBrowser({ allowedHosts: ['harness.test:80'] }, async ({ browser, attempted }) => {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
    for (const lang of ['en', 'ar']) {
      for (const shot of SHOTS) {
        const page = await browser.newPage({ viewport: { width: shot.view === 'dialog' ? 472 : 960, height: 900 }, deviceScaleFactor: 1 });
        await page.route('http://harness.test/**', (route) => {
          const path = new URL(route.request().url()).pathname.replace(/^\//, '') || 'index.html';
          try {
            route.fulfill({ body: readFileSync(join(harness, 'dist', path)), contentType: types[extname(path)] ?? 'application/octet-stream' });
          } catch {
            route.fulfill({ status: 404, body: '' });
          }
        });
        await page.goto(`http://harness.test/index.html?lang=${lang}&view=${shot.view}&detail=${encodeURIComponent(detail)}`);
        await page.waitForSelector(shot.ready, { timeout: 30_000 });
        if (shot.view === 'dialog') {
          // Open every group, so the warning's own text shows.
          for (const toggle of await page.$$('[data-capture="dialog"] button[aria-expanded="false"]')) await toggle.click();
        } else if (phase === 'after') await page.waitForSelector('[data-capture="reader"] h2 >> nth=1');
        await page.waitForTimeout(400);
        assert.equal(await page.evaluate(() => document.documentElement.dir), lang === 'ar' ? 'rtl' : 'ltr', `${lang} direction`);
        const target = await page.$(`[data-capture="${shot.view}"]`);
        await target.screenshot({ path: join(outDir, `${shot.name}-${lang}-${phase}.png`) });
        await page.close();
      }
    }
    return attempted?.length ?? 0;
  });
  console.log(`markdown parse budget captures (${phase}) written to ${outDir}; off-site requests attempted: ${attempts}`);
} finally {
  rmSync(harness, { recursive: true, force: true });
}
