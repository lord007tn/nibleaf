// Run against the owned production app :4310 and fictional site-preview-mock
// :4410, with the canonical devstack lock already acquired. No real API/data.
// node tests/integration/reader-search-query/browser.mjs
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const APP = 'http://localhost:4310';
const FIELD = '[data-slot="command-input"]';
const output = resolve('.github/assets/reader-search-query');
const lock = process.env.NIBLEAF_DEVSTACK_LOCK;
assert.ok(lock, 'Set NIBLEAF_DEVSTACK_LOCK to the canonical shared lock directory');
const owner = await readFile(`${lock}/owner.txt`, 'utf8');
assert.match(owner, /^reader\/853\b/);
assert.match(owner, /^branch=feat\/reader-search-query-graphemes$/m);
await mkdir(output, { recursive: true });
const checks = [];

await withLocalOnlyBrowser({ allowedHosts: [hostKey(APP)] }, async ({ browser, attempted }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  const page = await context.newPage();
  const queries = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/search') && url.searchParams.has('q')) queries.push(url.searchParams.get('q'));
  });
  const field = page.locator(FIELD);
  const hint = page.locator('[role="status"]').filter({ hasText: /200/ });
  const paste = async (text) => {
    await page.evaluate((value) => navigator.clipboard.writeText(value), text);
    await page.keyboard.press('Control+v');
  };
  const replace = async (text) => {
    await field.focus();
    await page.keyboard.press('Control+a');
    await paste(text);
  };
  const expectValue = async (expected) => {
    try {
      await page.waitForFunction(([selector, value]) => document.querySelector(selector)?.value === value, [FIELD, expected], { timeout: 5000 });
    } catch (cause) {
      throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(await field.inputValue())}`, { cause });
    }
  };
  const open = async (lang) => {
    await page.goto(`${APP}/sites/preview-harbor?lang=${lang}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => {
      const trigger = document.querySelector('[data-theme-region="search-trigger"]');
      return trigger && Object.keys(trigger).some((key) => key.startsWith('__reactProps'));
    });
    await page.keyboard.press('Control+k');
    await field.waitFor();
  };

  for (const lang of ['en', 'ar']) {
    for (const [size, viewport] of [
      ['desktop', { width: 1280, height: 800 }],
      ['mobile', { width: 390, height: 844 }],
    ]) {
      await page.setViewportSize(viewport);
      await open(lang);
      await replace(lang === 'ar' ? 'دليل البحث' : 'Search guide');
      await page.locator('[data-theme-surface="search"] [aria-busy="false"]').waitFor();
      await page.screenshot({ path: `${output}/before-${lang}-${size}.png` });
      const prefix = (lang === 'ar' ? 'ب' : 'x').repeat(199);
      await replace(`${prefix}${lang === 'ar' ? 'بَ' : '👩🏽‍💻'}extra`);
      await expectValue(prefix);
      await hint.waitFor();
      await page.locator('[data-theme-surface="search"] [aria-busy="false"]').waitFor();
      assert.equal(await hint.innerText(), lang === 'ar' ? 'الحد الأقصى للبحث هو 200 حرفًا.' : 'Search is limited to 200 characters.');
      const layout = await hint.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { direction: getComputedStyle(element).direction, left: bounds.left, right: bounds.right, viewport: innerWidth };
      });
      assert.equal(layout.direction, lang === 'ar' ? 'rtl' : 'ltr');
      assert.ok(layout.left >= 0 && layout.right <= layout.viewport);
      await page.screenshot({ path: `${output}/after-${lang}-${size}.png` });
      checks.push(`${lang}/${size}: native paste, whole grapheme, visible localized hint, direction and no horizontal overflow`);
    }
  }

  await page.setViewportSize({ width: 1280, height: 800 });
  for (const lang of ['en', 'ar']) {
    await open(lang);
    const previous = lang === 'ar' ? 'دليل البحث ' : 'Search guide ';
    await page.keyboard.type(previous);
    await paste((lang === 'ar' ? 'ب' : 'x').repeat(250));
    await expectValue(previous + (lang === 'ar' ? 'ب' : 'x').repeat(200 - [...previous].length));
    await page.keyboard.press('Control+z');
    await expectValue(previous);
    checks.push(`${lang}: native Ctrl+Z restores exact pre-paste text ${JSON.stringify(previous)}`);
  }

  await open('en');
  await replace('a'.repeat(200));
  await field.evaluate((element) => element.setSelectionRange(50, 60));
  await paste(`👩🏽‍💻${'b'.repeat(30)}`);
  await expectValue(`${'a'.repeat(50)}👩🏽‍💻${'b'.repeat(6)}${'a'.repeat(140)}`);
  assert.deepEqual(await field.evaluate((element) => [element.selectionStart, element.selectionEnd]), [63, 63]);
  checks.push('native selection replacement keeps surrounding text and caret');

  await replace('a'.repeat(200));
  await field.evaluate((element) => element.setSelectionRange(50, 60));
  await paste('a'.repeat(20));
  await expectValue('a'.repeat(200));
  assert.deepEqual(await field.evaluate((element) => [element.selectionStart, element.selectionEnd]), [60, 60]);
  checks.push('identical capped selection replacement collapses the caret after retained text');

  // Observe live-region text mutations, rather than assuming no reannouncement.
  await page.evaluate(() => {
    const element = document.getElementById(document.querySelector('[data-slot="command-input"]').getAttribute('aria-describedby'));
    window.limitMutations = 0;
    window.limitObserver = new MutationObserver((records) => {
      window.limitMutations += records.length;
    });
    window.limitObserver.observe(element, { subtree: true, childList: true, characterData: true });
  });
  await page.keyboard.type('zzzzz');
  assert.equal(
    await page.evaluate(() => {
      window.limitObserver.disconnect();
      return window.limitMutations;
    }),
    0,
  );
  checks.push('repeated rejected keys do not mutate the announcement');
  await replace('short');
  assert.equal(await hint.count(), 0);
  checks.push('accepted edit clears the stale hint');

  for (const order of ['input-first', 'compositionend-first']) {
    await replace('a'.repeat(198));
    const result = await field.evaluate((element, eventOrder) => {
      const raw = `${'a'.repeat(198)}e\u0301xy`;
      const input = (type) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, raw);
        element.setSelectionRange(raw.length, raw.length);
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type, isComposing: type === 'insertCompositionText' }));
      };
      element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      input('insertCompositionText');
      const during = element.value;
      if (eventOrder === 'input-first') input('insertText');
      element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'e\u0301xy' }));
      if (eventOrder === 'compositionend-first') input('insertText');
      return { during, raw };
    }, order);
    assert.equal(result.during, result.raw);
    await expectValue(`${'a'.repeat(198)}e\u0301`);
    await hint.waitFor();
    checks.push(`synthetic Latin composition in real Chromium: ${order}, uncut until compositionend`);
  }

  // Chromium protocol composition exercises its native event sequence. This is
  // still automation, not acceptance of an actual OS IME or Gboard keyboard.
  await replace('a'.repeat(198));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'e\u0301xy', selectionStart: 4, selectionEnd: 4 });
  await expectValue(`${'a'.repeat(198)}e\u0301xy`);
  await cdp.send('Input.insertText', { text: 'e\u0301xy' });
  await expectValue(`${'a'.repeat(198)}e\u0301`);
  await hint.waitFor();
  await cdp.detach();
  checks.push('Chromium protocol Latin composition stays uncut while active and reconciles its native commit event sequence');

  assert.ok(queries.length > 0);
  for (const query of queries) assert.ok([...query].length <= 200);
  checks.push(`all ${queries.length} observed API queries are <=200 code points`);
  await context.close();

  const recording = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: resolve('output/reader-search-query-video'), size: { width: 1280, height: 800 } },
  });
  await recording.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: APP });
  const demo = await recording.newPage();
  await demo.goto(`${APP}/sites/preview-harbor`, { waitUntil: 'networkidle' });
  await demo.keyboard.press('Control+k');
  await demo.locator(FIELD).waitFor();
  await demo.keyboard.type('Search guide ');
  await demo.evaluate(() => navigator.clipboard.writeText(`${'x'.repeat(185)}👩🏽‍💻extra`));
  await demo.keyboard.press('Control+v');
  await demo.locator('[role="status"]').filter({ hasText: /200/ }).waitFor();
  await demo.waitForTimeout(900); // Leave the hint readable in the review recording.
  await demo.keyboard.press('Control+z');
  await demo.waitForTimeout(600);
  await demo.keyboard.type('again');
  const video = demo.video();
  await recording.close();
  await video.saveAs(`${output}/interaction.webm`);
  assert.equal(attempted.length, 0);
  const evidence = {
    checks,
    nonLocalAttempts: attempted,
    browser: 'Chromium',
    limitations: [
      'Synthetic composition ordering is covered by component tests and browser events; no OS IME, Safari or Gboard device acceptance.',
      'Mobile screenshots use a desktop Chromium viewport; no software keyboard or screen-reader speech acceptance.',
    ],
  };
  await writeFile(`${output}/checks.json`, `${JSON.stringify(evidence, null, 2)}\n`);
});
console.log(JSON.stringify({ checks, nonLocalAttempts: 0 }, null, 2));
