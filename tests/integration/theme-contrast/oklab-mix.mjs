// Real-browser check that `mixOklab` (packages/shared/src/themes.ts) gives the
// colour Chromium draws for `color-mix(in oklab, <brand> <share>, white)`, to
// within 1/255 per channel. Pre-v1 dark mode ships that mix as CSS and decides
// from the JS value whether it reads (#744), so the two must agree.
// Each mix is painted as a swatch and read back from a screenshot of the page,
// so the comparison is with what the browser renders. No dev stack is needed:
//   node tests/integration/theme-contrast/oklab-mix.mjs
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const { mixOklab } = await import(pathToFileURL(resolve(root, 'packages/shared/src/themes.ts')).href);

// The default and Harbor brands, dark brands that fall short (#744), mid and
// light brands, and saturated primaries whose mix sits at the sRGB gamut edge.
const brands = [
  '#5546e8',
  '#b96a3d',
  '#000000',
  '#111111',
  '#0b3d91',
  '#1a1a2e',
  '#14532d',
  '#3b82f6',
  '#2f855a',
  '#f4b400',
  '#a3e635',
  '#ff0000',
  '#00ff00',
  '#0000ff',
  '#ff00ff',
  '#00ffff',
  '#7f7f7f',
  '#ffffff',
];
const shares = [0.72, 0.55];
const samples = brands.flatMap((brand) => shares.map((share) => ({ brand, share })));
const SIZE = 8;

const rows = await withLocalOnlyBrowser({ allowedHosts: [] }, async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: SIZE * samples.length, height: SIZE }, deviceScaleFactor: 1 });
  const swatches = samples
    .map(({ brand, share }) => `<i style="background:color-mix(in oklab,${brand} ${Math.round(share * 100)}%,white)"></i>`)
    .join('');
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0}body{display:flex}i{display:block;width:${SIZE}px;height:${SIZE}px;flex:none}</style></head><body>${swatches}</body></html>`,
  );
  const png = await page.screenshot({ type: 'png' });
  // Decode the screenshot in the page itself (no PNG library), reading the centre of each swatch.
  const pixels = await page.evaluate(
    async ({ data, count, size }) => {
      const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      return Array.from({ length: count }, (_, index) => Array.from(context.getImageData(index * size + size / 2, size / 2, 1, 1).data.slice(0, 3)));
    },
    { data: png.toString('base64'), count: samples.length, size: SIZE },
  );
  await page.close();
  return samples.map(({ brand, share }, index) => {
    const js = mixOklab(brand, '#ffffff', share);
    const expected = [1, 3, 5].map((start) => Number.parseInt(js.slice(start, start + 2), 16));
    const rendered = pixels[index];
    return { brand, share, js, rendered, delta: Math.max(...expected.map((value, channel) => Math.abs(value - rendered[channel]))) };
  });
});

for (const row of rows) {
  const hex = `#${row.rendered.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
  console.log(`${row.brand} ${Math.round(row.share * 100)}%  js ${row.js}  chromium ${hex}  max Δ ${row.delta}`);
}
const worst = Math.max(...rows.map((row) => row.delta));
console.log(`${rows.length} mixes, worst channel difference ${worst}/255`);
assert.ok(worst <= 1, `mixOklab differs from Chromium by ${worst}/255`);
