// Headless actual-component journey, synthetic clipboard and fictional data.
// Static Vite builds are served through Playwright interception, no server/DB.
// One invocation owns the machine-wide capture lock and releases it in finally.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const appDir = resolve(root, 'apps/app');
const appRequire = createRequire(resolve(appDir, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const output = resolve(root, '.github/assets/feat-editor-paste-and-title');
const baseline = process.env.BASELINE ?? '47ddeff639238867c5ecd8fb520dba46a1072edc';
// NIBLEAF_DEVSTACK_LOCK sets the lock path; only a lock this run created is released.
const lock = await acquireDevstackLock(`feat/editor-paste-and-title\n${root}`);
let browser;
let harness;
try {
  harness = await mkdtemp(resolve(appDir, '.paste-capture-'));
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Writer paste journey</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'main.tsx'), "import './styles.css';\nimport '../scripts/editor-paste-and-title.fixture.tsx';\n");
  // Tailwind must see utilities removed from the current source as well as the
  // current component. Vite's virtual baseline load alone is not a scan source.
  await writeFile(
    resolve(harness, 'baseline-title.tsx'),
    execFileSync('git', ['show', `${baseline}:apps/app/src/components/editor/page-title-field.tsx`], { cwd: root, encoding: 'utf8' }),
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@import "../src/content-blocks.css";\n@source "../src";\n@source "./baseline-title.tsx";\n@source "../scripts/editor-paste-and-title.fixture.tsx";\n',
  );
  const { build } = await fromApp('vite');
  const beforeFiles = ['extensions/clean-paste.ts', 'page-title-field.tsx', 'tiptap.css'];
  const evidence = [];
  // Only these hosts are reachable (capture-env.mjs); anything else fails the run.
  await withLocalOnlyBrowser({ allowedHosts: ['paste-journey.local:80'], launch: { headless: true } }, async ({ browser: guarded }) => {
    browser = guarded;
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
            name: 'paste-journey',
            enforce: 'pre',
            resolveId(source, importer) {
              if (source.startsWith('@nibleaf/')) return appRequire.resolve(source);
              if (source === './api-origin' && importer?.replaceAll('\\', '/').endsWith('/services/api.ts')) return '\0fixture-api-origin';
            },
            load(id) {
              // Page suggestions belong to the signed-in router, outside this
              // clipboard/title journey. The picker is never opened here.
              if (id.replaceAll('\\', '/').endsWith('/extensions/page-link-picker.tsx'))
                return 'export default function PageLinkPicker() { return null; }';
              if (id === '\0fixture-api-origin') return 'export const apiOrigin = () => window.location.origin;';
              const file = beforeFiles.find((file) => id.replaceAll('\\', '/').endsWith(`/src/components/editor/${file}`));
              if (phase === 'before' && file)
                return execFileSync('git', ['show', `${baseline}:apps/app/src/components/editor/${file}`], { cwd: root, encoding: 'utf8' });
            },
          },
        ],
        build: { outDir: dist, emptyOutDir: true, target: 'esnext' },
      });
      for (const locale of ['en', 'ar'])
        for (const width of [1440, 390]) {
          const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 }, reducedMotion: 'reduce' });
          const page = await context.newPage();
          const errors = [];
          page.on('pageerror', (error) => errors.push(error.message));
          await page.route('http://paste-journey.local/**', async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            const file = resolve(dist, pathname === '/' ? 'index.html' : `.${pathname}`);
            assert.ok(file.startsWith(`${dist}${sep}`));
            await route.fulfill({
              body: await readFile(file),
              contentType:
                { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[extname(file)] ??
                'application/octet-stream',
            });
          });
          await page.goto(`http://paste-journey.local/?locale=${locale}`);
          const field = page.getByRole('textbox', { name: locale === 'ar' ? 'عنوان الصفحة' : 'Page title', exact: true });
          await field.waitFor();
          const name = `${phase}-${locale}-${width}`;
          const frames = [];
          const frame = async () => {
            const path = resolve(harness, `${name}-${frames.length}.png`);
            await page.screenshot({ path });
            frames.push(path);
          };
          await frame();
          await page.keyboard.press('Tab');
          await field.focus();
          const title =
            locale === 'ar'
              ? 'نقل دليل الفريق إلى نبليف مع الحفاظ على القوائم والعناوين والروابط'
              : 'Bringing the team’s existing guide into Nibleaf with its lists and links';
          await field.fill(title);
          await frame();
          const geometry = await field.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
              height: element.clientHeight,
              lineHeight: Number.parseFloat(style.lineHeight),
              fontSize: Number.parseFloat(style.fontSize),
              width: element.clientWidth,
              scrollWidth: element.scrollWidth,
              border: style.borderWidth,
              font: style.fontFamily,
              focus: style.outlineStyle,
              focusWidth: Number.parseFloat(style.outlineWidth),
            };
          });
          assert.ok(geometry.scrollWidth <= geometry.width + 1, `${name}: title has no horizontal overflow`);
          if (phase === 'before' && width === 1440)
            assert.ok(Math.abs(geometry.fontSize - 33.6) < 0.1, `${name}: baseline responsive title utility is present`);
          if (width === 390) assert.ok(geometry.height > geometry.lineHeight * 1.8, `${name}: title wraps`);
          if (phase === 'after') {
            assert.equal(geometry.border, '0px');
            assert.equal(geometry.focus, 'solid', `${name}: visible keyboard focus outline`);
            assert.ok(geometry.focusWidth >= 2);
            await field.fill((locale === 'ar' ? 'عنوان' : 'Title').repeat(40));
            assert.equal(await field.evaluate((el) => el.scrollWidth <= el.clientWidth + 1), true, `${name}: unbroken title wraps`);
            await field.fill(title);
          }
          await field.press('Enter');
          assert.equal(await page.locator('.ProseMirror').evaluate((el) => document.activeElement === el), true);
          let html = await readFile(resolve(appDir, 'src/components/editor/__fixtures__/google-docs.reconstructed.html'), 'utf8');
          if (locale === 'ar')
            for (const [english, arabic] of [
              ['Moving a document', 'نقل مستند'],
              ['First item', 'العنصر الأول'],
              ['Second item', 'العنصر الثاني'],
              ['Nested item', 'عنصر متداخل'],
              [' with ', ' مع '],
              ['emphasis', 'توكيد'],
              ['Deep link', 'رابط متداخل'],
              ['Third item', 'العنصر الثالث'],
              ['Numbered item', 'عنصر مرقم'],
              ['Numbered child', 'عنصر فرعي مرقم'],
              ['Next number', 'الرقم التالي'],
            ])
              html = html.replaceAll(english, arabic);
          const pasteHTML = (html) =>
            page.locator('.ProseMirror').evaluate((element, html) => {
              const data = new DataTransfer();
              data.setData('text/html', html);
              data.setData('text/plain', 'Writer clipboard fixture');
              element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
            }, html);
          await pasteHTML(html);
          await page.locator('.ProseMirror h2').waitFor();
          await frame();
          const empty = await page.locator('.ProseMirror li p').evaluateAll((elements) => elements.filter((el) => !el.textContent.trim()).length);
          assert.equal(phase === 'before' ? empty > 0 : empty === 0, true, `${name}: expected gap state`);
          await page.screenshot({ path: resolve(output, `${name}.png`) });
          await frame();
          // Pillow is already installed on the capture machine. Each GIF uses
          // lossless screenshot frames, a 128-color palette and explicit timing.
          execFileSync('python', [
            '-c',
            'from PIL import Image; import sys; images=[Image.open(p).convert("RGB").quantize(colors=128) for p in sys.argv[2:]]; images[0].save(sys.argv[1],save_all=True,append_images=images[1:],duration=[700,900,1400,900],loop=0,optimize=True)',
            resolve(output, `${name}.gif`),
            ...frames,
          ]);
          // Independently reproduce the Notion fixture on the same real editor.
          // Media above remains the Google Docs journey; both inputs are checked.
          await page.locator('.ProseMirror').click();
          await page.keyboard.press('Control+a');
          await page.keyboard.press('Backspace');
          await pasteHTML(await readFile(resolve(appDir, 'src/components/editor/__fixtures__/notion.reconstructed.html'), 'utf8'));
          await page.locator('.ProseMirror h2').waitFor();
          const notionEmpty = await page
            .locator('.ProseMirror li p')
            .evaluateAll((elements) => elements.filter((el) => !el.textContent.trim()).length);
          assert.equal(phase === 'before' ? notionEmpty > 0 : notionEmpty === 0, true, `${name}: Notion expected gap state`);
          assert.deepEqual(errors, [], `${name}: no browser errors`);
          evidence.push({ phase, locale, width, geometry, emptyListParagraphs: empty, notionEmptyListParagraphs: notionEmpty });
          await context.close();
          console.log(`${name}: captured, empty list paragraphs: Docs=${empty}, Notion=${notionEmpty}`);
        }
    }
    await writeFile(
      resolve(output, 'evidence.json'),
      `${JSON.stringify({ baseline, syntheticPaste: true, isolatedComponents: true, captures: evidence }, null, 2)}\n`,
    );
  });
} finally {
  await browser?.close();
  if (harness) await rm(harness, { recursive: true, force: true });
  await lock.release();
}
