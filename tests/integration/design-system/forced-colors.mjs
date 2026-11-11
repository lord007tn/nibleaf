// Real-browser check that design-system controls keep their cues in forced
// colors (Windows High Contrast), where backgrounds and box shadows are dropped.
//
// It builds a throwaway page with the real design-system CSS (Vite, inside
// apps/app so workspace packages resolve), opens it in Chromium with
// `forced-colors: active` emulated, asserts the computed styles, and removes
// the page again. No dev stack is needed:
//   node tests/integration/design-system/forced-colors.mjs [screenshotPath]
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { build } from 'vite';
import { chromiumExecutable } from '../lib/capture-env.mjs';

const appDir = fileURLToPath(new URL('../../../apps/app/', import.meta.url));
const harness = join(appDir, '.forced-colors-check');
// The page is built the way the app builds its own: with the app's Vite plugins.
const fromApp = (name) => import(pathToFileURL(createRequire(join(appDir, 'package.json')).resolve(name)).href);
const screenshot = process.argv[2];

rmSync(harness, { recursive: true, force: true });
mkdirSync(harness, { recursive: true });
writeFileSync(
  join(harness, 'index.html'),
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>forced colors</title></head><body class="bg-background text-foreground"><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
);
writeFileSync(join(harness, 'styles.css'), '@import "@nibleaf/design-system/globals.css";\n@source "../../../packages/design-system/src";\n');
writeFileSync(
  join(harness, 'main.tsx'),
  `import { Meter } from '@nibleaf/design-system/components/ui/meter';
import { CheckboxField } from '@nibleaf/design-system/components/ui/checkbox';
import { RadioField, RadioGroup } from '@nibleaf/design-system/components/ui/radio-group';
import { createRoot } from 'react-dom/client';
import './styles.css';
createRoot(document.getElementById('root')).render(
  <div className="flex max-w-md flex-col gap-6 p-8">
    <Meter label="Published pages used" tone="primary" value={40} valueText="40 of 100" />
    <Meter label="Storage used" tone="warning" value={85} valueText="85 of 100" />
    <Meter label="Builds used" tone="danger" value={100} valueText="120 of 100" />
    <CheckboxField label="Documentation" />
    <RadioGroup aria-label="Role" defaultValue="member">
      <RadioField label="Viewer" value="viewer" />
      <RadioField label="Member" value="member" />
    </RadioGroup>
  </div>,
);
`,
);

try {
  await build({
    root: harness,
    base: './',
    logLevel: 'warn',
    configFile: false,
    plugins: [(await fromApp('@tailwindcss/vite')).default(), (await fromApp('@vitejs/plugin-react')).default()],
    build: { outDir: join(harness, 'dist'), emptyOutDir: true },
  });

  const browser = await chromium.launch({
    executablePath: chromiumExecutable(),
  });
  const page = await browser.newPage({ viewport: { width: 520, height: 420 } });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
  await page.route('http://harness.local/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\//, '') || 'index.html';
    route.fulfill({ body: readFileSync(join(harness, 'dist', path)), contentType: types[extname(path)] ?? 'application/octet-stream' });
  });
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'dark' });
  await page.goto('http://harness.local/index.html');
  await page.waitForSelector('[data-slot="meter-bar"]');
  assert.equal(await page.evaluate(() => matchMedia('(forced-colors: active)').matches), true, 'forced colors are emulated');

  const visible = (color) => color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent';
  // Meter: the bar is drawn as a border, which forced colors keep (a background alone is dropped).
  const bars = await page.$$eval('[data-slot="meter-bar"]', (els) =>
    els.map((el) => {
      const style = getComputedStyle(el);
      return { top: style.borderTopWidth, bottom: style.borderBottomWidth, color: style.borderTopColor, width: el.getBoundingClientRect().width };
    }),
  );
  assert.equal(bars.length, 3);
  for (const bar of bars) {
    assert.equal(bar.top, '3px', 'meter bar top border');
    assert.equal(bar.bottom, '3px', 'meter bar bottom border');
    assert.ok(visible(bar.color), `meter bar border is painted (${bar.color})`);
    assert.ok(bar.width > 0, 'meter bar has width');
  }
  // Radio: the chosen dot is a border too.
  const dot = await page.$eval('[data-slot="radio-group-indicator"]', (el) => {
    const style = getComputedStyle(el);
    return { width: style.borderTopWidth, color: style.borderTopColor };
  });
  assert.equal(dot.width, '4px', 'radio dot border');
  assert.ok(visible(dot.color), `radio dot is painted (${dot.color})`);
  // Focus: a keyboard-focused checkbox shows an outline in forced colors.
  await page.keyboard.press('Tab');
  const outline = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement);
    return { role: document.activeElement?.getAttribute('role'), width: style.outlineWidth, style: style.outlineStyle, color: style.outlineColor };
  });
  assert.equal(outline.role, 'checkbox');
  assert.equal(outline.style, 'solid', 'focus outline in forced colors');
  assert.equal(outline.width, '2px');
  assert.ok(visible(outline.color), `focus outline is painted (${outline.color})`);

  if (screenshot) await page.screenshot({ path: screenshot });
  await browser.close();
  console.log('design-system forced colors: all checks passed');
} finally {
  rmSync(harness, { recursive: true, force: true });
}
