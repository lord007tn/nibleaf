// Render the fixture first; see README.md. No server or backing services needed.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acquireDevstackLock, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const fixture = process.env.IMAGE_DIMENSIONS_FIXTURE ?? join(tmpdir(), 'nibleaf-reader-image-dimensions');
const output = resolve('.github/assets/perf/reader-image-dimensions');
const sizes = JSON.parse(await readFile(join(fixture, 'sizes.json'), 'utf8'));
const css = await readFile('apps/app/src/typeset.css', 'utf8');
await mkdir(output, { recursive: true });
process.env.NIBLEAF_DEVSTACK_LOCK ??= 'C:/Users/raedb/.t3/worktrees/nibleaf/editor-devstack.lock';
const lock = await acquireDevstackLock('Codex P2-PUB-013 image dimensions fixture');
const rows = [];
try {
  await withLocalOnlyBrowser({ allowedHosts: ['reader-images.test:80'], launch: { headless: true } }, async ({ browser, attempted }) => {
    for (const width of [1440, 390]) {
      for (const language of ['en', 'ar']) {
        for (const appearance of ['light', 'dark']) {
          for (const mode of ['before', 'after']) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: appearance });
            const page = await context.newPage();
            await page.addInitScript(() => {
              window.shifts = [];
              new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.shifts.push({ value: entry.value, at: entry.startTime });
              }).observe({ type: 'layout-shift', buffered: true });
            });
            const article = await readFile(join(fixture, `${language}-${mode}.html`), 'utf8');
            // Explicitly gate image headers until the first paint. This exposes
            // the aspect-ratio shift without conflating network/font variance.
            let release;
            const imageGate = new Promise((resolve) => {
              release = resolve;
            });
            await page.route('http://reader-images.test/**', async (route) => {
              const path = new URL(route.request().url()).pathname;
              const match = /^\/fixture-(\d)\.svg$/.exec(path);
              if (match) {
                await imageGate;
                const [w, h] = sizes[Number(match[1])];
                await route.fulfill({
                  contentType: 'image/svg+xml',
                  body: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#185d82"/><text x="40" y="90" fill="white" font-family="sans-serif" font-size="44">${w} x ${h}</text></svg>`,
                });
                return;
              }
              await route.fulfill({
                contentType: 'text/html',
                body: `<!doctype html><html lang="${language}" dir="${language === 'ar' ? 'rtl' : 'ltr'}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reader image dimensions fixture</title><style>${css}
                :root{--foreground:#17212b;--background:#fff;--border:#ccd4db;--font-heading:Arial;--font-mono:monospace;--radius:8px}
                @media(prefers-color-scheme:dark){:root{--foreground:#f1f5f9;--background:#101820;--border:#415161}}
                *{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--foreground);font:16px Arial,sans-serif}main{max-width:760px;margin:0 auto;padding:24px}.reader-image{position:relative;display:inline-block;max-width:100%}.reader-image img{vertical-align:bottom}.reader-image-zoom{display:none}.dark\\:hidden{display:block}.hidden{display:none}
                </style><main>${article}</main></html>`,
              });
            });
            await page.goto(`http://reader-images.test/${mode}`, { waitUntil: 'domcontentloaded' });
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
            await page.waitForTimeout(600);
            const reserved = await page.locator('img').evaluateAll((images) =>
              images.map((image) => ({
                width: image.getAttribute('width'),
                height: image.getAttribute('height'),
                reservedHeight: image.getBoundingClientRect().height,
              })),
            );
            release();
            // Load every lazy image before the final screenshot, then measure
            // at the original viewport without introducing reader-input shifts.
            await page.locator('img').evaluateAll((images) =>
              images.forEach((image) => {
                image.loading = 'eager';
              }),
            );
            await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
            await page.waitForTimeout(250);
            const measured = await page.evaluate(() => {
              let max = 0;
              let sum = 0;
              let start = 0;
              let previous = 0;
              for (const shift of window.shifts) {
                if (shift.at - previous > 1000 || shift.at - start > 5000) {
                  start = shift.at;
                  sum = 0;
                }
                sum += shift.value;
                previous = shift.at;
                max = Math.max(max, sum);
              }
              return {
                cls: max,
                shifts: window.shifts,
                rendered: [...document.images].map((image) => ({
                  width: image.width,
                  height: image.height,
                  naturalWidth: image.naturalWidth,
                  naturalHeight: image.naturalHeight,
                })),
              };
            });
            assert.equal(reserved.length, 5);
            if (mode === 'after') {
              assert.deepEqual(
                reserved.map((image) => [Number(image.width), Number(image.height)]),
                sizes,
              );
              assert.ok(reserved.every((image) => image.reservedHeight > 0));
              assert.ok(measured.cls < 0.001, `Unexpected after CLS: ${measured.cls}`);
              await page.screenshot({ path: join(output, `${language}-${width}-${appearance}.png`), fullPage: true });
            } else {
              assert.ok(reserved.every((image) => image.width === null && image.height === null));
              assert.ok(measured.cls > 0, 'Baseline must reproduce the image shift');
            }
            rows.push({
              width,
              language,
              appearance,
              mode,
              cls: measured.cls,
              shifts: measured.shifts,
              // Compact tuples retain every measured value without repeating field names.
              reserved: reserved.map((image) => [image.width, image.height, image.reservedHeight]),
              rendered: measured.rendered.map((image) => [image.width, image.height, image.naturalWidth, image.naturalHeight]),
            });
            await context.close();
          }
        }
      }
    }
    assert.equal(attempted.length, 0);
  });
  await writeFile(
    join(output, 'measurements.json'),
    `${JSON.stringify({ method: 'Actual Markdown SSR fixture + reader typeset.css; five delayed SVG headers; 900px viewport height; CLS maximum session window; fresh context for each run; no hydration or production chrome', reservedTuple: ['width attribute', 'height attribute', 'reserved CSS height'], renderedTuple: ['CSS width', 'CSS height', 'natural width', 'natural height'], sizes, outsideNetworkAttempts: 0, rows }, null, 2)}\n`,
  );
  console.table(rows.map(({ width, language, appearance, mode, cls }) => ({ width, language, appearance, mode, cls })));
} finally {
  await lock.release();
}
