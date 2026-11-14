/** Fixture capture only. Start the 4410 mock and 4310 Vite server under the shared lock. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { hostKey, withLocalOnlyBrowser } from '../tests/integration/lib/capture-env.mjs';

const phase = process.argv[2] ?? 'after';
assert.ok(['before', 'after'].includes(phase));
const base = 'http://localhost:4310';
const out = path.resolve('docs/assets/reader-language-paths');
await mkdir(out, { recursive: true });
const escapeHtml = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const records = [];
await withLocalOnlyBrowser(
  {
    allowedHosts: [hostKey(base), hostKey('http://localhost:4410')],
    launch: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  async ({ browser, attempted }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
      ...(phase === 'after' ? { recordVideo: { dir: out, size: { width: 1440, height: 900 } } } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120_000);
    for (const language of ['en', 'ar']) {
      const suffix = language === 'ar' ? (phase === 'after' ? '/ar' : '') : '';
      const url = `${base}/sites/preview-harbor${suffix}/getting-started/introduction${language === 'ar' && phase === 'before' ? '?lang=ar' : ''}`;
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
      assert.equal(response.status(), 200);
      await page.waitForFunction(() =>
        [...document.querySelectorAll('a[href]')].some((anchor) => Object.keys(anchor).some((key) => key.startsWith('__react'))),
      );
      const html = await response.text();
      const tags = [html.match(/<html\b[^>]*>/i)?.[0], ...html.matchAll(/<link\b[^>]*(?:canonical|hreflang)[^>]*>/gi)]
        .map((tag) => (typeof tag === 'string' ? tag : tag?.[0]))
        .filter(Boolean);
      const record = { language, requestedUrl: url, browserUrl: page.url(), status: response.status(), tags };
      records.push(record);
      await writeFile(path.join(out, `${phase}-${language}-ssr.txt`), `<!-- Unmodified SSR tag excerpts from ${url} -->\n${tags.join('\n')}\n`);
      const screenshot = await page.screenshot();
      // A labeled evidence sheet: observed Playwright URL and unmodified page capture.
      // Playwright viewport screenshots do not contain Chrome's native omnibox.
      const sheet = await context.newPage();
      await sheet.setContent(
        `<html><body style="margin:0;font:16px monospace;background:#f8fafc;color:#0f172a"><header style="padding:18px;border-bottom:1px solid #cbd5e1"><b>${phase.toUpperCase()} / ${language.toUpperCase()} - fixture browser evidence</b><p>Observed browser URL: ${escapeHtml(page.url())}</p><pre style="white-space:pre-wrap;font-size:12px">${escapeHtml(tags.join('\n'))}</pre></header><img style="width:1440px;display:block" src="data:image/png;base64,${screenshot.toString('base64')}"></body></html>`,
      );
      await sheet.screenshot({ path: path.join(out, `${phase}-${language}.png`), fullPage: true });
      await sheet.close();
    }
    if (phase === 'after') {
      await page.goto(`${base}/sites/preview-harbor/getting-started/introduction?lang=ar&tab=cli#what-you-can-build`, {
        waitUntil: 'networkidle',
        timeout: 120_000,
      });
      assert.equal(page.url(), `${base}/sites/preview-harbor/ar/getting-started/introduction?tab=cli#what-you-can-build`);
      records.push({ check: 'HTTP 308 fragment inheritance', browserUrl: page.url() });
      let documents = 0;
      page.on('request', (request) => {
        if (request.resourceType() === 'document') documents++;
      });
      const next = page.locator('a[rel="next"]').first();
      await next.click();
      await page.waitForURL('**/sites/preview-harbor/ar/getting-started/installation');
      assert.equal(documents, 0, 'pager uses client navigation');
      records.push({ check: 'client pager retains language', browserUrl: page.url(), documentRequests: documents });
    }
    records.push({ outsideNetworkAttempts: attempted.length });
    const video = page.video();
    await context.close();
    if (phase === 'after' && video) await video.saveAs(path.join(out, 'navigation.webm'));
  },
);
await writeFile(path.join(out, `${phase}.json`), `${JSON.stringify(records, null, 2)}\n`);
console.log(JSON.stringify(records, null, 2));
