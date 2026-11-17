import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const fixture = JSON.parse(readFileSync(new URL('./.local.json', import.meta.url)));
const dir = new URL('../../../.github/assets/maxio-upload-proxy/', import.meta.url);
mkdirSync(dir, { recursive: true });
// Only these hosts are reachable (capture-env.mjs); anything else fails the run.
await withLocalOnlyBrowser({ allowedHosts: ['127.0.0.1:4530', '127.0.0.1:220'], launch: { headless: true } }, async ({ browser }) => {
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: fileURLToPath(dir) } });
    await context.addCookies(
      fixture.cookie.split('; ').map((part) => {
        const index = part.indexOf('=');
        return { name: part.slice(0, index), value: part.slice(index + 1), url: 'http://127.0.0.1:4530' };
      }),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.on('pageerror', (error) => console.log('page error:', error.message));
    await page.goto(`http://127.0.0.1:4530/app/projects/${fixture.projectId}/editor?page=${fixture.pageId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 180_000,
    });
    const editor = page.locator('.ProseMirror[contenteditable=true]').last();
    await editor.waitFor({ timeout: 90_000 });
    console.log('Editor ready');
    await editor.click();
    await editor.press('Control+Home');
    const picture = await page.screenshot();
    const uploaded = page.waitForResponse((response) => response.url().includes('/assets/confirm') && response.status() === 201, { timeout: 90_000 });
    await editor.press('Enter');
    await editor.press('ArrowUp');
    await editor.pressSequentially('/image');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('option', { name: /Image/ }).first().click();
    await (await chooser).setFiles({ name: 'editor-upload.png', mimeType: 'image/png', buffer: picture });
    const confirmed = (await (await uploaded).json()).data;
    console.log('Upload confirmed');
    const image = page.locator(`img[src="${confirmed.url}"]`).first();
    await image.waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      (src) => Array.from(document.images).some((img) => img.getAttribute('src') === src && img.complete && img.naturalWidth > 0),
      confirmed.url,
      { timeout: 30_000 },
    );
    assert.ok(await image.evaluate((img) => img.naturalWidth > 0));
    await page.screenshot({ path: new URL('editor-upload.png', dir).pathname.replace(/^\//, ''), fullPage: true });
    writeFileSync(
      new URL('browser-result.json', dir),
      `${JSON.stringify({ uploadConfirmed: true, renderedImage: true, width: await image.evaluate((img) => img.naturalWidth) }, null, 2)}\n`,
    );
    await context.close();
    console.log('Browser closed');
    renameSync(await page.video().path(), new URL('editor-upload.webm', dir));
  } finally {
    await browser.close();
  }
});
