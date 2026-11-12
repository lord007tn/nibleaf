// Real-browser check that the reader's deferred controls (header language menu,
// phone drawer) respond to the first Enter, Space or tap even while their code
// is still downloading, and say so when it fails (READER-05, #465).
//
// Runs against a production build of the app (:4310) with the dependency-free
// public site mock standing in for the API (:4311). See README.md here.
//   node tests/integration/reader-deferred-controls/browser.mjs [videoDir]
//
// Each scenario uses a fresh browser context (no cached chunks) and holds the
// control's chunk back with `page.route` while the reader acts on the static
// trigger, then lets it through and checks the control opened.
import assert from 'node:assert/strict';
import { hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const APP = process.env.APP_URL ?? 'http://localhost:4310';
const SITE = process.env.SITE_ID ?? 'preview-harbor';
const videoDir = process.argv[2];
const MENUS = /\/assets\/header-menus-[^/]+\.js(\?.*)?$/;
const DRAWER = /\/assets\/mobile-nav-drawer-[^/]+\.js(\?.*)?$/;

// Only the local app is reachable (capture-env.mjs); anything else fails the run.
const failures = [];
await withLocalOnlyBrowser({ allowedHosts: [hostKey(APP)] }, async ({ browser }) => {
  /** A page whose `chunk` waits for `release()`, or fails while `fail` is set. */
  async function gatedPage(chunk, options = {}) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      ...options,
      ...(videoDir ? { recordVideo: { dir: videoDir, size: options.viewport ?? { width: 960, height: 600 } } } : {}),
    });
    const page = await context.newPage();
    let release = () => undefined;
    const ready = new Promise((resolve) => {
      release = resolve;
    });
    const gate = { fail: false };
    await page.route(chunk, async (route) => {
      if (gate.fail) return route.abort();
      await ready;
      return route.continue();
    });
    await page.goto(`${APP}/sites/${SITE}`, { waitUntil: 'load' });
    // Handlers exist once React has hydrated the static trigger.
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button[aria-haspopup]')].some((button) => Object.keys(button).some((key) => key.startsWith('__reactProps'))),
      undefined,
      { timeout: 60_000 },
    );
    return { context, page, release, gate };
  }

  async function scenario(name, run) {
    try {
      await run();
      console.log(`ok   ${name}`);
    } catch (error) {
      failures.push(name);
      console.log(`FAIL ${name}: ${error.message}`);
    }
  }

  const LANGUAGE_TRIGGER = 'button[data-slot="dropdown-menu-trigger"]';

  for (const key of ['Enter', ' ']) {
    await scenario(`keyboard ${key === ' ' ? 'Space' : 'Enter'} on the language trigger opens the menu once its code arrives`, async () => {
      const { context, page, release } = await gatedPage(MENUS);
      await page.locator(LANGUAGE_TRIGGER).first().focus();
      await page.keyboard.press(key);
      assert.equal(await page.locator('[role="menu"]').count(), 0, 'the menu code has not loaded yet');
      release();
      await page.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 30_000 });
      // Focus moved into the menu (the static trigger it was on is gone).
      assert.ok(
        await page.evaluate(() => Boolean(document.activeElement?.closest('[role="menu"], [data-slot="dropdown-menu-trigger"]'))),
        'focus stays with the control',
      );
      await context.close();
    });
  }

  await scenario('a tap on the phone menu button opens the drawer once its code arrives', async () => {
    const { context, page, release } = await gatedPage(DRAWER, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await page.locator('button[data-slot="sheet-trigger"]').tap();
    assert.equal(await page.locator('[role="dialog"]').count(), 0, 'the drawer code has not loaded yet');
    release();
    await page.locator('[role="dialog"]').waitFor({ state: 'visible', timeout: 30_000 });
    await context.close();
  });

  await scenario('a failed download is announced, and selecting the trigger again opens the menu', async () => {
    const { context, page, release, gate } = await gatedPage(MENUS);
    gate.fail = true;
    // The first failed chunk reloads the page once (stale-deploy recovery); a
    // failure after that is the one the reader is told about.
    const reloaded = page.waitForEvent('load', { timeout: 15_000 });
    await page.locator(LANGUAGE_TRIGGER).first().click();
    await reloaded;
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('button[aria-haspopup]')].some((button) => Object.keys(button).some((key) => key.startsWith('__reactProps'))),
      undefined,
      { timeout: 60_000 },
    );
    await page.locator(LANGUAGE_TRIGGER).first().click();
    const status = page.locator(`${LANGUAGE_TRIGGER} ~ [role="status"]`).first();
    await status.filter({ hasText: /\S/ }).waitFor({ timeout: 15_000 });
    gate.fail = false;
    release();
    await page.locator(LANGUAGE_TRIGGER).first().click();
    await page.locator('[role="menu"]').waitFor({ state: 'visible', timeout: 30_000 });
    await context.close();
  });
});
if (failures.length > 0) {
  console.error(`reader deferred controls: ${failures.length} failed`);
  process.exit(1);
}
console.log('reader deferred controls: all checks passed');
