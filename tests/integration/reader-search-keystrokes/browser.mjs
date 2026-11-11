// Real-browser check that reader search keeps every keystroke typed while it
// opens (READER-06), driving real key, paste and IME events in Chromium.
//
// Runs against a production build of the app (:4310) with the dependency-free
// public site mock standing in for the API (:4311). See README.md here.
//   node tests/integration/reader-search-keystrokes/browser.mjs [videoDir]
//
// Every scenario loads the page with the search dialog's chunk held back
// (`page.route`), presses Ctrl+K and types at once, so keys land in the hidden
// field and the loading shell before the chunk is let through mid-typing.
// Each asserts the dialog field's final value and that it has focus.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const APP = process.env.APP_URL ?? 'http://localhost:4310';
const SITE = process.env.SITE_ID ?? 'preview-harbor';
const videoDir = process.argv[2];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1248/chrome-win64/chrome.exe`,
});
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 960, height: 600 } } } : {}),
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);

// The dialog's code (site-search-dialog-<hash>.js) waits until `release()`.
let gate = { ready: Promise.resolve(), release: () => undefined };
const hold = () => {
  let release = () => undefined;
  const ready = new Promise((resolve) => {
    release = resolve;
  });
  gate = { ready, release };
};
await page.route(/\/assets\/site-search-dialog-[^/]+\.js(\?.*)?$/, async (route) => {
  await gate.ready;
  await route.continue();
});

const FIELD = '[data-slot="command-input"]';
const SHELL = '[data-search-shell] input';
const failures = [];

/** Loads the reader cold (dialog chunk held), waits for hydration, presses Ctrl+K. */
async function coldOpen({ lang } = {}) {
  hold();
  await page.goto(`${APP}/sites/${SITE}${lang ? `?lang=${lang}` : ''}`, { waitUntil: 'load' });
  // The shortcut listener exists once React has hydrated the search trigger.
  await page.waitForFunction(
    () => {
      const trigger = document.querySelector('[data-theme-region="search-trigger"]');
      return Boolean(trigger && Object.keys(trigger).some((key) => key.startsWith('__reactProps')));
    },
    undefined,
    { timeout: 60_000 },
  );
  await page.keyboard.press('Control+k');
  // The cold path is really exercised: the shell is up, the dialog is not.
  await page.locator(SHELL).waitFor({ timeout: 5000 });
  assert.equal(await page.locator(FIELD).count(), 0, 'the dialog has not loaded yet');
}

/** Lets the dialog's code through and waits for its field. */
async function release() {
  gate.release();
  await page.locator(FIELD).waitFor({ state: 'attached', timeout: 30_000 });
}

const state = () =>
  page.evaluate(
    ([fieldSelector, shellSelector]) => {
      const field = document.querySelector(fieldSelector);
      return {
        value: field?.value ?? null,
        focused: Boolean(field) && document.activeElement === field,
        caretAtEnd: Boolean(field) && field.selectionStart === field.value.length && field.selectionEnd === field.value.length,
        shell: Boolean(document.querySelector(shellSelector)),
      };
    },
    [FIELD, SHELL],
  );

async function expectField(name, expected) {
  // The hand-over finishes within a frame or two of the field mounting.
  await page
    .waitForFunction(
      ([selector, value]) => {
        const field = document.querySelector(selector);
        return field && field.value === value && document.activeElement === field;
      },
      [FIELD, expected],
      { timeout: 5000 },
    )
    .catch(() => undefined);
  const actual = await state();
  try {
    assert.equal(actual.value, expected, `${name}: field value`);
    assert.equal(actual.focused, true, `${name}: the dialog's field has focus`);
    assert.equal(actual.caretAtEnd, true, `${name}: caret at the end`);
    assert.equal(actual.shell, false, `${name}: the loading shell is gone`);
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error.message} (${JSON.stringify(actual)})`);
  }
}

// 1. Typing immediately after Ctrl+K on a cold load, across the hand-over.
await coldOpen();
await page.keyboard.type('cancel ');
await release();
await page.keyboard.type('reservation');
await expectField('typing right after Ctrl+K on a cold load', 'cancel reservation');

// 2. Arabic (RTL), across the hand-over.
await coldOpen({ lang: 'ar' });
await page.keyboard.type('إلغاء ');
await release();
await page.keyboard.type('الحجز');
await expectField('Arabic typed across the hand-over', 'إلغاء الحجز');

// 3. Backspace before and after the hand-over.
await coldOpen();
await page.keyboard.type('setx');
await page.keyboard.press('Backspace');
await release();
await page.keyboard.type('upp');
await page.keyboard.press('Backspace');
await expectField('Backspace before and after the hand-over', 'setup');

// 4. Paste (Ctrl+V from the clipboard) before the hand-over.
await coldOpen();
await page.evaluate(() => navigator.clipboard.writeText('reservation'));
await page.keyboard.type('cancel ');
await page.keyboard.press('Control+v');
await release();
await page.keyboard.type(' policy');
await expectField('paste before the hand-over', 'cancel reservation policy');

// 5. Select all and replace before the hand-over.
await coldOpen();
await page.keyboard.type('cancel');
await page.keyboard.press('Control+a');
await page.keyboard.type('ref');
await release();
await page.keyboard.type('und');
await expectField('select all and replace across the hand-over', 'refund');

// 6. An IME composition open when the dialog's code arrives: it finishes in the
//    shell and only then moves to the dialog, committed text included.
await coldOpen();
await page.keyboard.type('r');
await page.locator(SHELL).waitFor();
await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
await release();
await page.waitForTimeout(300);
const composing = await state();
try {
  assert.equal(composing.shell, true, 'the shell stays while its field is composing');
  assert.equal(composing.value, '', 'the dialog does not take the pre-edit text');
  assert.equal(
    await page.evaluate((selector) => document.activeElement === document.querySelector(selector), SHELL),
    true,
    'focus stays in the composing shell field',
  );
  console.log('ok   composition stays put while the dialog arrives');
} catch (error) {
  failures.push('composition stays put while the dialog arrives');
  console.log(`FAIL composition stays put while the dialog arrives: ${error.message} (${JSON.stringify(composing)})`);
}
await cdp.send('Input.insertText', { text: '課' });
await page.keyboard.type('e');
await expectField('composition finished across the hand-over', 'r課e');

// 7. Reopen (code now loaded): typing replaces the old query, and deleting it all
//    leaves the field empty. With the code loaded the field mounts within the
//    shortcut's own task, so the buffer's "edited but empty" case (a reopen
//    before the field is ready) is covered by site-search.test.tsx instead.
await page.keyboard.press('Escape');
await page.keyboard.press('Control+k');
await page.keyboard.type('x');
await page.keyboard.press('Backspace');
await page.locator(FIELD).waitFor();
await expectField('reopen, type and delete everything', '');

await context.close();
await browser.close();
if (failures.length > 0) {
  console.error(`reader search keystrokes: ${failures.length} failed`);
  process.exit(1);
}
console.log('reader search keystrokes: all checks passed');
