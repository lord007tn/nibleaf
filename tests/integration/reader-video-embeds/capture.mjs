// Before/after captures of the mock's video tour page (AUTH-11, PR 1): the
// click-to-load facades, the link card for a frame from another site and a
// <video>, in English and Arabic at 1440 and 390, with every request the page
// makes before and after the first play (browser.mjs captures each step).
//
// Takes the machine-wide dev-stack lock, starts the public site mock (:4311) and,
// in turn, main's built app (NIBLEAF_BEFORE_APP: its apps/app directory) and
// this branch's (:4310), then stops them and releases the lock. See README.md.
//   NIBLEAF_BEFORE_APP=/path/to/main/apps/app node tests/integration/reader-video-embeds/capture.mjs
//
// Writes page-<phase>-<lang>-<width>.png and request-log.json to .github/assets/feat-reader-video-embeds/.
// Provider and example.com responses are stubbed, so nothing leaves the machine;
// every request the page makes is still recorded.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const ROOT = resolve(import.meta.dirname, '../../..');
const OUTPUT = join(ROOT, '.github/assets/feat-reader-video-embeds');
const APP = 'http://localhost:4310';
const MOCK = 'http://localhost:4311';
const PAGE = `${APP}/sites/preview-harbor/guides/video-tour`;
const BEFORE_APP = process.env.NIBLEAF_BEFORE_APP;
assert.ok(BEFORE_APP, "Set NIBLEAF_BEFORE_APP to main's built apps/app directory");

const PROVIDER_HOST = /(^|\.)(youtube(-nocookie)?\.com|youtu\.be|ytimg\.com|googlevideo\.com|vimeo(cdn)?\.com|loom(cdn)?\.com|wistia\.(com|net))$/;
const isProvider = (url) => PROVIDER_HOST.test(new URL(url).hostname);
const isOffsite = (url) => isProvider(url) || /(^|\.)example\.com$/.test(new URL(url).hostname);
const STUB = (host) =>
  `<!doctype html><html><body style="margin:0;display:grid;place-items:center;height:100vh;background:#111;color:#eee;font:16px system-ui">${host} player (stubbed in this capture)</body></html>`;

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
const stop = (child) =>
  new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) return done();
    child.once('exit', done);
    child.kill();
  });

const children = new Set();
let browser;
const cleanup = async () => {
  await browser?.close().catch(() => undefined);
  for (const child of children) await stop(child);
};
const lock = await acquireDevstackLock('reader-video-embeds captures', { onInterrupt: cleanup });
const log = [];
try {
  await mkdir(OUTPUT, { recursive: true });
  const mock = spawn(process.execPath, ['scripts/site-preview-mock.mjs', '--port', '4311'], { cwd: ROOT, stdio: 'ignore' });
  children.add(mock);
  await waitFor(`${MOCK}/api/public/sites/preview-harbor`);
  // Only the local app and mock are reachable (capture-env.mjs); provider requests are
  // answered by the routes below, and anything else fails the run.
  await withLocalOnlyBrowser(
    { allowedHosts: [hostKey(APP), hostKey(MOCK)], launch: { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false } },
    async ({ browser: guarded }) => {
      browser = guarded;

      for (const [phase, appDir] of [
        ['before', resolve(BEFORE_APP)],
        ['after', join(ROOT, 'apps/app')],
      ]) {
        const app = spawn(process.execPath, ['.output/server/index.mjs'], { cwd: appDir, env: { ...process.env, PORT: '4310' }, stdio: 'ignore' });
        children.add(app);
        await waitFor(APP);
        for (const lang of ['en', 'ar'])
          for (const width of [1440, 390]) {
            const context = await browser.newContext({
              viewport: { width, height: width < 600 ? 844 : 900 },
              deviceScaleFactor: 1,
              ...(width < 600 ? { isMobile: true, hasTouch: true } : {}),
            });
            const page = await context.newPage();
            const requests = [];
            page.on('request', (request) => requests.push(request.url()));
            await context.route(isOffsite, (route) => {
              const url = new URL(route.request().url());
              if (isProvider(url.href)) return route.fulfill({ status: 200, contentType: 'text/html', body: STUB(url.hostname) });
              return route.fulfill({ status: 204 });
            });
            await page.goto(`${PAGE}${lang === 'en' ? '' : `?lang=${lang}`}`, { waitUntil: 'networkidle' });
            await page.locator('.typeset').first().waitFor({ timeout: 60_000 });
            await page.waitForTimeout(1500);
            // The whole article from the top of the page, so the sticky header doesn't cover it.
            const box = await page
              .locator('.typeset')
              .first()
              .evaluate((element) => {
                const rect = element.getBoundingClientRect();
                return { x: rect.left + scrollX, y: rect.top + scrollY, width: rect.width, height: rect.height };
              });
            const margin = 16;
            await page.screenshot({
              path: join(OUTPUT, `page-${phase}-${lang}-${width}.png`),
              fullPage: true,
              clip: {
                x: Math.max(0, box.x - margin),
                y: Math.max(0, box.y - margin),
                width: Math.min(width, box.width + 2 * margin),
                height: box.height + 2 * margin,
              },
            });

            const entry = {
              phase,
              lang,
              width,
              embeds: await page.locator('[data-theme-component="video-embed"]').count(),
              linkCards: await page.locator('a[data-theme-component="embed-link"]').count(),
              iframesBeforePlay: await page.locator('iframe').count(),
              videos: await page
                .locator('.typeset video')
                .evaluateAll((videos) =>
                  videos.map((video) => Object.fromEntries([...video.attributes].map((attribute) => [attribute.name, attribute.value]))),
                ),
              offsiteRequestsBeforePlay: requests.filter(isOffsite),
              requestsBeforePlay: requests.length,
            };
            if (phase === 'after') {
              assert.deepEqual(entry.offsiteRequestsBeforePlay, [], `${lang} ${width}: no off-site request before play`);
              const play = page.locator('[data-theme-component="video-embed"] button').first();
              await play.scrollIntoViewIfNeeded();
              const before = requests.length;
              await play.click();
              const frame = page.locator('[data-theme-component="video-embed"] iframe').first();
              await frame.waitFor();
              await page.waitForLoadState('networkidle');
              await page.waitForTimeout(500);
              entry.requestsAfterPlay = requests.slice(before);
              entry.offsiteRequestsAfterPlay = entry.requestsAfterPlay.filter(isOffsite);
            }
            log.push(entry);
            console.log(
              `${phase} ${lang} ${width}: ${entry.embeds} facades, ${entry.linkCards} link cards, ${entry.videos.length} videos, off-site before play ${entry.offsiteRequestsBeforePlay.length}${entry.offsiteRequestsAfterPlay ? `, after ${JSON.stringify(entry.offsiteRequestsAfterPlay)}` : ''}`,
            );
            await context.close();
          }
        await stop(app);
        children.delete(app);
      }
      await writeFile(join(OUTPUT, 'request-log.json'), `${JSON.stringify(log, null, 2)}\n`);
    },
  );
} finally {
  await cleanup();
  await lock.release();
}
