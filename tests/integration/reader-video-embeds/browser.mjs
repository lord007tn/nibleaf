// Real-browser check that the reader's video embeds contact no provider before
// the reader presses play, and load exactly the chosen player after (AUTH-11).
//
// Takes the machine-wide dev-stack lock, starts the dependency-free public site
// mock (:4311) and the production build of the app (:4310), runs the checks in
// Chromium, then stops both and releases the lock. See README.md here.
//   node tests/integration/reader-video-embeds/browser.mjs [captureDir]
//
// Provider responses are stubbed with `page.route`, so the run never reaches
// the real providers; every request the page makes is still recorded.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { acquireDevstackLock, chromiumExecutable } from '../lib/capture-env.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const APP = 'http://localhost:4310';
const MOCK = 'http://localhost:4311';
const PAGE = `${APP}/sites/preview-harbor/guides/video-tour`;
const captureDir = process.argv[2] ? resolve(process.argv[2]) : null;

/** Every host a provider's player, thumbnails or media are served from. */
const PROVIDER_HOST = /(^|\.)(youtube(-nocookie)?\.com|youtu\.be|ytimg\.com|googlevideo\.com|vimeo(cdn)?\.com|loom(cdn)?\.com|wistia\.(com|net))$/;
const isProvider = (url) => PROVIDER_HOST.test(new URL(url).hostname);
const PLAY = '[data-theme-component="video-embed"] button';

const STUB = (name) =>
  `<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#111;color:#eee;font:16px system-ui">${name} player (stubbed in this check)</body></html>`;

const waitFor = async (url) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`${url} did not start`);
};

const lock = await acquireDevstackLock('reader-video-embeds browser check');
const children = [];
let browser;
const failures = [];
try {
  children.push(spawn(process.execPath, ['scripts/site-preview-mock.mjs', '--port', '4311'], { cwd: ROOT, stdio: 'ignore' }));
  children.push(
    spawn(process.execPath, ['.output/server/index.mjs'], { cwd: join(ROOT, 'apps/app'), env: { ...process.env, PORT: '4310' }, stdio: 'ignore' }),
  );
  await waitFor(`${MOCK}/api/public/sites/preview-harbor`);
  await waitFor(APP);
  if (captureDir) await mkdir(captureDir, { recursive: true });
  browser = await chromium.launch({ executablePath: chromiumExecutable() });

  /** A page on the tour with every request recorded and provider responses stubbed. */
  const open = async ({ lang = 'en', width = 1440, javaScriptEnabled = true } = {}) => {
    const context = await browser.newContext({
      viewport: { width, height: width < 600 ? 844 : 900 },
      javaScriptEnabled,
      ...(width < 600 ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await context.newPage();
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await context.route(isProvider, (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: STUB(new URL(route.request().url()).hostname) }),
    );
    await page.goto(`${PAGE}${lang === 'en' ? '' : `?lang=${lang}`}`, { waitUntil: 'networkidle' });
    if (javaScriptEnabled) await page.locator(PLAY).first().waitFor({ timeout: 60_000 });
    return { context, page, providerRequests: () => requests.filter(isProvider) };
  };
  const shot = async (page, name, options = {}) => {
    if (captureDir) await page.screenshot({ path: join(captureDir, `${name}.png`), ...options });
  };

  const scenario = async (name, run) => {
    try {
      await run();
      console.log(`ok   ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`FAIL ${name}: ${error.message}`);
    }
  };

  for (const [lang, width] of [
    ['en', 1440],
    ['ar', 390],
    ['en', 390],
    ['ar', 1440],
  ]) {
    await scenario(`${lang} ${width}: no provider request before play, one player after, with focus`, async () => {
      const { context, page, providerRequests } = await open({ lang, width });
      const buttons = page.locator(PLAY);
      assert.equal(await buttons.count(), 2, 'a player button for the YouTube and the Loom video');
      const label = await buttons.first().getAttribute('aria-label');
      assert.equal(
        label,
        lang === 'ar' ? 'تشغيل الفيديو: جولة في تايدووتر (يُحمَّل من YouTube)' : 'Play video: Tidewater product tour (loads from YouTube)',
      );
      assert.equal(await page.locator('iframe').count(), 0, 'no iframe before play');
      // Let lazy chunks, prefetches and idle work settle: still nothing to a provider.
      await page.waitForTimeout(1500);
      assert.deepEqual(providerRequests(), [], 'no provider request before play');
      if (lang === 'ar') assert.equal(await page.evaluate(() => document.documentElement.dir), 'rtl');
      const box = await buttons.first().boundingBox();
      assert.ok(box && Math.abs(box.width / box.height - 16 / 9) < 0.02, 'the poster reserves a 16:9 box');
      await buttons.first().scrollIntoViewIfNeeded();
      await shot(page, `poster-${lang}-${width}`);

      // Keyboard: from the paragraph before the video, Tab reaches the play button.
      await page.locator('.typeset p').first().click();
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), label, 'Tab reaches the play button');
      await shot(page, `focus-${lang}-${width}`);
      await page.keyboard.press('Enter');
      const frame = page.locator('[data-theme-component="video-embed"] iframe');
      await frame.waitFor();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'IFRAME', 'focus moves into the player');
      assert.equal(await frame.getAttribute('src'), 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=1');
      assert.deepEqual(providerRequests(), ['https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?autoplay=1'], 'only the chosen player loads');
      assert.equal(await page.locator(PLAY).count(), 1, 'the Loom video is still waiting');
      await shot(page, `playing-${lang}-${width}`);

      const card = page.locator('a[data-theme-component="embed-link"]');
      assert.equal(await card.getAttribute('href'), 'https://maps.example.com/tidewater/live');
      assert.match((await card.textContent()) ?? '', /maps\.example\.com/);
      await card.scrollIntoViewIfNeeded();
      await shot(page, `link-card-${lang}-${width}`);
      await context.close();
    });
  }

  await scenario('without JavaScript, each video is a link to the provider page and nothing is requested from it', async () => {
    const { context, page, providerRequests } = await open({ javaScriptEnabled: false });
    assert.equal(await page.locator('[data-theme-component="video-embed"] a[href="https://www.youtube.com/watch?v=M7lc1UVf-VE"]').count(), 1);
    assert.equal(await page.locator('iframe').count(), 0);
    assert.deepEqual(providerRequests(), []);
    await shot(page, 'no-javascript-en-1440');
    await context.close();
  });
} finally {
  await browser?.close();
  for (const child of children) child.kill();
  await lock.release();
}

if (failures.length > 0) {
  console.error(`reader video embeds: ${failures.length} failed`);
  process.exit(1);
}
