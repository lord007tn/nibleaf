// Real-browser check of the published page's layout details that only a browser's
// cascade and font loading can show (see README.md here):
// - an Arabic page on a phone, slow network and 4x slower CPU, doesn't jump when
//   its web font loads (the page actions used to wrap under the title);
// - the theme's title rules reach the title (Manuscript's face, the RTL leading);
// - from 80rem the header's Ask AI entry is the only one: no floating launcher;
// - with a mouse, a heading's section link sits right after the heading text;
// - code on an Arabic page keeps its monospace face, token by token.
//
// Runs against a production build of the app (:4310) with the public site mock.
//   node tests/integration/reader-page-layout/browser.mjs
import assert from 'node:assert/strict';
import { hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const APP = process.env.APP_URL ?? 'http://localhost:4310';
const MOCK = process.env.MOCK_URL ?? 'http://localhost:4311';
const site = (id, path) => `${APP}/sites/${id}/${path}`;
const failures = [];
const check = async (name, run) => {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}\n     ${error.message.split('\n')[0]}`);
  }
};
const settle = (page) => page.evaluate(() => document.fonts.ready.then(() => new Promise((resolve) => setTimeout(resolve, 600))));

await withLocalOnlyBrowser({ allowedHosts: [hostKey(APP), hostKey(MOCK)] }, async ({ browser }) => {
  await check('an Arabic page on a slow phone keeps its layout while fonts load (CLS < 0.1)', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await context.route('**/*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return route.fallback();
    });
    await context.addInitScript(() => {
      window.__cls = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(site('preview-answers', 'ar/guides/webhooks'), { waitUntil: 'load', timeout: 90_000 });
    await settle(page);
    const cls = await page.evaluate(() => window.__cls);
    assert.ok(cls < 0.1, `CLS ${cls.toFixed(4)}`);
    await context.close();
  });

  await check("the theme's title rules reach the title (Manuscript face, RTL leading)", async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(site('preview-manuscript', 'guides/authentication'), { waitUntil: 'load' });
    await settle(page);
    const family = await page.locator('article h1').evaluate((h1) => getComputedStyle(h1).fontFamily);
    assert.match(family, /^"?Iowan Old Style/, family);
    await page.goto(site('preview-answers', 'ar/guides/authentication'), { waitUntil: 'load' });
    await settle(page);
    const ratio = await page
      .locator('article h1')
      .evaluate((h1) => Number.parseFloat(getComputedStyle(h1).lineHeight) / Number.parseFloat(getComputedStyle(h1).fontSize));
    assert.ok(Math.abs(ratio - 1.3) < 0.01, `Arabic title line height ${ratio.toFixed(2)}`);
    await context.close();
  });

  await check('from 80rem the header Ask AI entry is the only one; narrower screens keep the launcher', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(site('preview-answers', 'guides/authentication'), { waitUntil: 'load' });
    await settle(page);
    assert.ok(await page.locator('[data-theme-region="ask-ai-trigger"]').isVisible(), 'the header entry shows at 1440');
    assert.equal(await page.locator('[data-chat-launcher]').isVisible(), false, 'no floating launcher at 1440');
    await page.setViewportSize({ width: 1024, height: 800 });
    assert.ok(await page.locator('[data-chat-launcher] button').isVisible(), 'the launcher shows at 1024');
    await context.close();
  });

  await check('with a mouse, the section link sits right after the heading text (EN and AR)', async () => {
    for (const path of ['guides/authentication', 'ar/guides/authentication']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(site('preview-answers', path), { waitUntil: 'load' });
      await settle(page);
      const gap = await page
        .locator('article .reader-heading')
        .first()
        .evaluate((heading) => {
          const range = document.createRange();
          range.selectNodeContents(heading.querySelector('h2, h3, h4'));
          const text = [...range.getClientRects()].at(-1);
          const link = heading.querySelector('.reader-section-link').getBoundingClientRect();
          return getComputedStyle(heading).direction === 'rtl' ? text.left - link.right : link.left - text.right;
        });
      assert.ok(gap >= 0 && gap < 24, `${path}: ${gap.toFixed(1)}px between the heading text and its link`);
      await context.close();
    }
  });

  await check('code on an Arabic page keeps its monospace face, token by token', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(site('preview-answers', 'ar/guides/authentication'), { waitUntil: 'load' });
    await settle(page);
    const fonts = await page.evaluate(() => {
      const font = (selector) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).fontFamily : null;
      };
      return { block: font('article pre code'), token: font('article pre code span'), inline: font('article p code') };
    });
    for (const [where, family] of Object.entries(fonts)) assert.match(family ?? '', /Mono|monospace/, `${where}: ${family}`);
    await context.close();
  });
});

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
