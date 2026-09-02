#!/usr/bin/env node
/**
 * Capture screenshots of the published-site reader for every theme preset,
 * light + dark, English + Arabic (RTL), desktop + mobile, on the home page and
 * one component-heavy deep page. Pairs with scripts/site-preview-mock.mjs.
 *
 * Output: output/theme-shots/<label>/<preset>-<light|dark>-<en|ar>-<desktop|mobile>-<home|deep>.png
 *         output/theme-shots/<label>/index.html   (contact sheet)
 *         output/theme-shots/<label>/manifest.json
 *
 * Usage:
 *   node scripts/site-preview-mock.mjs                 # terminal 1 (port 4311)
 *   cd apps/app && pnpm dev                            # terminal 2 (port 4310)
 *   node scripts/site-preview-shots.mjs --label before [--base http://localhost:4310]
 *       [--presets harbor,manuscript,signal,legacy] [--deep guides/authentication]
 *       [--chromium <path to chrome.exe>] [--no-fullpage]
 *
 * Requires playwright-core (already in the repo's node_modules) and a Playwright
 * Chromium build under %LOCALAPPDATA%\ms-playwright (newest that launches wins).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ─── CLI ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
};

const LABEL = String(flag('label', 'before'));
const BASE = String(flag('base', 'http://localhost:4310')).replace(/\/+$/, '');
const PRESETS = String(flag('presets', 'harbor,manuscript,signal,legacy'))
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
const DEEP_PATH = String(flag('deep', 'guides/authentication')).replace(/^\/+|\/+$/g, '');
const CHROMIUM_OVERRIDE = flag('chromium', process.env.PLAYWRIGHT_CHROMIUM ?? '');
const FULL_PAGE = flag('no-fullpage', false) !== true;
const OUT_DIR = path.join(REPO_ROOT, 'output', 'theme-shots', LABEL);

const MODES = ['light', 'dark'];
const LANGS = ['en', 'ar'];
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, isMobile: false },
  mobile: { width: 390, height: 844, isMobile: true },
};
const PAGES = { home: '', deep: DEEP_PATH };

// ─── Chromium discovery ──────────────────────────────────────────────────────

const chromiumCandidates = () => {
  if (CHROMIUM_OVERRIDE && CHROMIUM_OVERRIDE !== true) return [String(CHROMIUM_OVERRIDE)];
  const root =
    process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(process.env.LOCALAPPDATA || path.join(homedir(), 'AppData', 'Local'), 'ms-playwright');
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
    .flatMap((name) =>
      ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']
        .map((rel) => path.join(root, name, rel))
        .filter((candidate) => existsSync(candidate)),
    );
};

const launchBrowser = async () => {
  const candidates = chromiumCandidates();
  const errors = [];
  for (const executablePath of candidates) {
    try {
      const browser = await chromium.launch({ executablePath, headless: true });
      return { browser, executablePath };
    } catch (error) {
      errors.push(`${executablePath}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }
  // Last resort: whatever playwright-core resolves on its own.
  try {
    const browser = await chromium.launch({ headless: true });
    return { browser, executablePath: '(playwright default)' };
  } catch (error) {
    errors.push(`default: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  throw new Error(`No Chromium build could be launched.\n${errors.join('\n')}`);
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const siteUrl = (projectId, pagePath, lang) => {
  const query = lang === 'en' ? '' : `?lang=${encodeURIComponent(lang)}`;
  return `${BASE}/sites/${projectId}${pagePath ? `/${pagePath}` : ''}${query}`;
};

const waitForServer = async (url, timeoutMs = 180_000) => {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      const body = await response.text();
      if (response.ok && /<html/i.test(body)) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error(`Timed out waiting for ${url} (${lastError})`);
};

const settle = async (page, mode) => {
  await page.waitForSelector('h1', { timeout: 60_000 });
  // The reader applies the stored/visitor theme after hydration; wait for the
  // document class to agree with the requested mode before capturing.
  await page.waitForFunction(
    (expected) =>
      document.documentElement.classList.contains(expected) && !document.documentElement.classList.contains(expected === 'dark' ? 'light' : 'dark'),
    mode,
    { timeout: 30_000 },
  );
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
    // A long-polling dev connection is fine; the h1 + theme checks above are the real gate.
  });
  await page
    .evaluate(() => document.fonts?.ready)
    .catch(() => {
      // Fonts are best-effort.
    });
  await page.waitForTimeout(250);
  // Vite's dev-only HMR overlay (e.g. a transient proxy ECONNRESET while the
  // optimizer reloads) would otherwise hide the whole page in the capture.
  await page.evaluate(() => {
    for (const overlay of document.querySelectorAll('vite-error-overlay')) overlay.remove();
  });
};

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

const writeContactSheet = (shots, meta) => {
  const groups = new Map();
  for (const shot of shots) {
    const list = groups.get(shot.preset) ?? [];
    list.push(shot);
    groups.set(shot.preset, list);
  }
  const sections = [...groups.entries()]
    .map(([preset, list]) => {
      const cards = list
        .map((shot) =>
          shot.error
            ? `<figure class="shot error"><div class="frame"><p>${escapeHtml(shot.error)}</p></div><figcaption>${escapeHtml(shot.file)}</figcaption></figure>`
            : `<figure class="shot ${shot.viewport}"><a href="${escapeHtml(shot.file)}" target="_blank" rel="noopener"><div class="frame"><img src="${escapeHtml(shot.file)}" alt="${escapeHtml(shot.file)}" loading="lazy"></div></a><figcaption><strong>${escapeHtml(shot.mode)}</strong> · ${escapeHtml(shot.lang)} · ${escapeHtml(shot.viewport)} · ${escapeHtml(shot.page)}<br><a href="${escapeHtml(shot.url)}" target="_blank" rel="noopener"><code>${escapeHtml(shot.url)}</code></a></figcaption></figure>`,
        )
        .join('\n');
      return `<section><h2>${escapeHtml(preset)} <small>preview-${escapeHtml(preset)}</small></h2><div class="grid">${cards}</div></section>`;
    })
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Theme shots — ${escapeHtml(meta.label)}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, "Segoe UI", sans-serif; }
  body { margin: 0; padding: 24px; background: #f4f4f5; color: #18181b; }
  @media (prefers-color-scheme: dark) { body { background: #111113; color: #e4e4e7; } .frame { background: #1c1c1f; border-color: #2a2a2e; } }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .meta { color: #71717a; font-size: 13px; margin: 0 0 24px; }
  section { margin-bottom: 40px; }
  h2 { font-size: 16px; text-transform: capitalize; margin: 0 0 12px; }
  h2 small { font-weight: 400; color: #71717a; font-family: ui-monospace, monospace; text-transform: none; margin-inline-start: 8px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .shot { margin: 0; }
  .shot .frame { border: 1px solid #d4d4d8; border-radius: 8px; overflow: hidden; background: #fff; height: 220px; }
  .shot.mobile .frame { height: 320px; }
  .shot img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: top; }
  .shot.mobile img { width: auto; margin: 0 auto; }
  .shot.error .frame { display: grid; place-items: center; color: #b91c1c; font-size: 12px; padding: 12px; }
  figcaption { font-size: 12px; color: #52525b; margin-top: 6px; line-height: 1.5; }
  figcaption code { font-size: 11px; }
  a { color: inherit; }
</style>
</head>
<body>
<h1>Theme shots — ${escapeHtml(meta.label)}</h1>
<p class="meta">${escapeHtml(meta.capturedAt)} · base ${escapeHtml(meta.base)} · deep page <code>${escapeHtml(meta.deepPath)}</code> · ${shots.filter((shot) => !shot.error).length}/${shots.length} captured · chromium ${escapeHtml(meta.chromium)}</p>
${sections}
</body>
</html>
`;
  writeFileSync(path.join(OUT_DIR, 'index.html'), html, 'utf8');
};

// ─── Main ────────────────────────────────────────────────────────────────────

const main = async () => {
  mkdirSync(OUT_DIR, { recursive: true });
  const firstProject = `preview-${PRESETS[0]}`;
  process.stdout.write(`Waiting for ${BASE}/sites/${firstProject} …\n`);
  await waitForServer(`${BASE}/sites/${firstProject}`);

  const { browser, executablePath } = await launchBrowser();
  process.stdout.write(`Chromium: ${executablePath}\n`);
  const shots = [];
  let failures = 0;

  try {
    for (const preset of PRESETS) {
      const projectId = `preview-${preset}`;
      for (const mode of MODES) {
        for (const [viewport, size] of Object.entries(VIEWPORTS)) {
          const context = await browser.newContext({
            viewport: { width: size.width, height: size.height },
            isMobile: size.isMobile,
            hasTouch: size.isMobile,
            deviceScaleFactor: 1,
            colorScheme: 'light',
            reducedMotion: 'reduce',
            locale: 'en-US',
          });
          // The reader honours a visitor's stored choice over the configured
          // default (see apps/app/src/lib/site-theme.ts siteThemeNoFlashScript).
          await context.addInitScript(
            ({ key, value }) => {
              try {
                window.localStorage.setItem(key, value);
              } catch {
                // ignore
              }
            },
            { key: `nibleaf.site.theme.${projectId}`, value: mode },
          );
          const page = await context.newPage();
          page.setDefaultNavigationTimeout(120_000);
          for (const lang of LANGS) {
            for (const [pageKey, pagePath] of Object.entries(PAGES)) {
              const file = `${preset}-${mode}-${lang}-${viewport}-${pageKey}.png`;
              const url = siteUrl(projectId, pagePath, lang);
              const shot = { preset, projectId, mode, lang, viewport, page: pageKey, file, url };
              try {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                await settle(page, mode);
                const dir = await page.evaluate(() => document.documentElement.getAttribute('dir') || getComputedStyle(document.body).direction);
                shot.dir = dir;
                await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: FULL_PAGE });
                process.stdout.write(`ok   ${file} (dir=${dir})\n`);
              } catch (error) {
                failures += 1;
                shot.error = error instanceof Error ? error.message.split('\n')[0] : String(error);
                process.stdout.write(`FAIL ${file}: ${shot.error}\n`);
              }
              shots.push(shot);
            }
          }
          await context.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  const meta = { label: LABEL, base: BASE, deepPath: DEEP_PATH, capturedAt: new Date().toISOString(), chromium: executablePath, fullPage: FULL_PAGE };
  writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify({ ...meta, shots }, null, 2), 'utf8');
  writeContactSheet(shots, meta);
  process.stdout.write(`\n${shots.length - failures}/${shots.length} shots → ${OUT_DIR}\nContact sheet: ${path.join(OUT_DIR, 'index.html')}\n`);
  if (failures > 0) process.exitCode = 1;
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exit(1);
});
