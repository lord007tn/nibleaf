// Real-browser check of the settings leave guard and shell (operations/ui-overhaul.md
// §5.3, §5.7, §8.3), through the real router.
//
// Runs against a local dev stack (app on APP_URL, default :4310) with a signed-in
// Playwright storage state:
//   STATE=path/to/state.json PROJECT_ID=<site id> node tests/integration/settings-leave-guard/browser.mjs [videoDir]
//
// It asserts, on Site settings → General:
// 1. unsaved edits: leaving through the settings nav asks first;
// 2. after a successful save: the nav and a reload leave without any prompt;
// 3. while a save is in flight (the request is held back), even with the text
//    typed back to its saved value: the nav asks first and a reload triggers
//    the browser's beforeunload prompt;
// 4. one scroll: the page scrolls, the content has no scrollbar of its own, and
//    the nav stays below the site header;
// 5. on a phone: /settings is the list of pages; "All settings" with unsaved
//    edits asks first, "Keep editing" keeps them, "Discard" goes to the list
//    and the page opens again with the saved value and no guard.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { chromiumExecutable } from '../lib/capture-env.mjs';

const APP = process.env.APP_URL ?? 'http://localhost:4310';
const { STATE, PROJECT_ID } = process.env;
if (!STATE || !PROJECT_ID) throw new Error('Set STATE (Playwright storage state) and PROJECT_ID');
const videoDir = process.argv[2];

const browser = await chromium.launch({
  executablePath: chromiumExecutable(),
});
const context = await browser.newContext({
  storageState: STATE,
  viewport: { width: 1280, height: 800 },
  ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 960, height: 600 } } } : {}),
});
await context.addCookies([{ name: 'NIBLEAF_LOCALE', value: 'en', url: APP }]);
const page = await context.newPage();

const dialogs = [];
page.on('dialog', async (dialog) => {
  dialogs.push(dialog.type());
  await dialog.dismiss();
});

const general = `${APP}/app/projects/${PROJECT_ID}/settings?section=general`;
const name = () => page.getByLabel('Name', { exact: true });
const saveBar = () => page.getByRole('region', { name: 'Unsaved changes' });
const leaveDialog = () => page.getByRole('dialog').filter({ hasText: 'Leave without saving?' });
const settingsNav = () => page.getByRole('navigation', { name: 'Settings' });
const navToLanguages = () => settingsNav().getByRole('link', { name: 'Languages' }).click();
const pause = (ms) => page.waitForTimeout(ms);

async function open() {
  await page.goto(general, { waitUntil: 'load' });
  await name().waitFor({ timeout: 60_000 });
  await pause(500);
}

const original = 'Documentation';
await open();
await name().fill(original);

// 1. Unsaved edits: the nav asks.
await name().fill(`${original} draft`);
await saveBar().waitFor();
await navToLanguages();
await leaveDialog().waitFor({ timeout: 5000 });
await pause(800);
await page.getByRole('button', { name: 'Keep editing' }).click();
assert.match(page.url(), /section=general/, 'stays on General after Keep editing');

// 2. A successful save clears the guard: nav and reload leave without a prompt.
await page.keyboard.press('Control+s');
await saveBar().waitFor({ state: 'hidden', timeout: 15_000 });
await pause(600);
await navToLanguages();
await page.waitForURL(/section=languages/, { timeout: 10_000 });
assert.equal(await leaveDialog().count(), 0, 'no leave prompt after a successful save');
await open();
dialogs.length = 0;
await name().click();
await page.reload({ waitUntil: 'load' });
assert.deepEqual(dialogs, [], 'no beforeunload prompt after a successful save');
await name().waitFor({ timeout: 60_000 });

// 3. A save in flight keeps the guard up, even with the text typed back.
let release;
const held = new Promise((resolve) => {
  release = resolve;
});
await page.route('**/api/app/projects/*', async (route) => {
  if (route.request().method() === 'PATCH') await held;
  // The reload below may have aborted a held request already.
  await route.continue().catch(() => undefined);
});
await name().fill(`${original} renamed`);
await page.keyboard.press('Control+s');
await pause(400);
await name().fill(original);
await pause(400);
assert.equal(await saveBar().count(), 1, 'the save bar stays while the save is in flight');
await navToLanguages();
await leaveDialog().waitFor({ timeout: 5000 });
await pause(800);
await page.getByRole('button', { name: 'Keep editing' }).click();
dialogs.length = 0;
await page.reload({ waitUntil: 'commit' }).catch(() => undefined);
await pause(500);
assert.deepEqual(dialogs, ['beforeunload'], 'reload during a save asks first');

// Let the save finish; the field still differs from what was saved, so save the original back.
release();
await page.unroute('**/api/app/projects/*');
await pause(1500);
if ((await saveBar().count()) > 0) {
  await page.keyboard.press('Control+s');
  await saveBar().waitFor({ state: 'hidden', timeout: 15_000 });
}
await pause(800);

// 4. One scroll: the document scrolls; the content column doesn't; the nav sticks below the header.
await open();
const geometry = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="Settings"]');
  const content = document.querySelector('[data-slot="page-container"]')?.parentElement;
  const before = nav?.getBoundingClientRect().top ?? -1;
  window.scrollTo(0, document.scrollingElement.scrollHeight);
  return {
    pageScrolls: document.scrollingElement.scrollHeight > window.innerHeight,
    contentOwnScroll: content ? content.scrollHeight > content.clientHeight + 1 : true,
    navTopBefore: before,
    navTopAfter: nav?.getBoundingClientRect().top ?? -1,
    scrolled: window.scrollY,
  };
});
assert.ok(geometry.pageScrolls, 'the page itself scrolls on a long settings page');
assert.ok(!geometry.contentOwnScroll, 'the content has no scrollbar of its own');
assert.ok(geometry.scrolled > 0, 'the window scrolled');
assert.equal(Math.round(geometry.navTopAfter), 48, 'the nav sticks right below the 48px site header');

// 5. Phone: the list, the Back link and the guard.
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${APP}/app/projects/${PROJECT_ID}/settings`, { waitUntil: 'load' });
await settingsNav().getByRole('link', { name: 'General' }).waitFor({ timeout: 60_000 });
assert.equal(
  await name()
    .isVisible()
    .catch(() => false),
  false,
  'the list page shows no form',
);
await settingsNav().getByRole('link', { name: 'General' }).click();
await name().waitFor({ timeout: 60_000 });
await pause(500);
assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'H1', 'opening a page focuses its heading');
await name().fill(`${original} phone draft`);
const back = () => page.getByRole('link', { name: 'All settings' });
await back().click();
await leaveDialog().waitFor({ timeout: 5000 });
await page.getByRole('button', { name: 'Keep editing' }).click();
assert.equal(await name().inputValue(), `${original} phone draft`, 'Keep editing keeps the edit');
await back().click();
await leaveDialog().waitFor({ timeout: 5000 });
await page.getByRole('button', { name: 'Discard changes' }).click();
await page.waitForURL((url) => !url.search.includes('section='), { timeout: 10_000 });
await pause(500);
assert.equal(await page.evaluate(() => document.activeElement?.textContent), 'Settings', 'the list heading takes focus on the way back');
await settingsNav().getByRole('link', { name: 'General' }).click();
await name().waitFor({ timeout: 60_000 });
assert.equal(await name().inputValue(), original, 'the discarded draft is gone');
dialogs.length = 0;
await back().click();
await page.waitForURL((url) => !url.search.includes('section='), { timeout: 10_000 });
assert.equal(await leaveDialog().count(), 0, 'no guard once the draft is gone');

await context.close();
await browser.close();
console.log('settings leave guard and shell: all checks passed');
