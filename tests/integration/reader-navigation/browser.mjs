// Real-browser check of the published reader's client-side navigation (READER-05b):
// intent prefetch for plain `<a>` page links on public sites only, the pager's
// next page on idle, Back from cache, links the browser must keep, and the
// full-page fallback, only for transport failures and never twice. A prefetch
// must never send anything but the page load itself: no page view, search, AI
// or event request.
//
// Runs against a production build of the app (:4310) with the dependency-free
// public site mock standing in for the API. See README.md here.
//   node tests/integration/reader-navigation/browser.mjs [videoDir]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const APP = process.env.APP_URL ?? 'http://localhost:4310';
const MOCK = process.env.MOCK_URL ?? 'http://localhost:4311';
const SITE = process.env.SITE_ID ?? 'preview-harbor';
const PRIVATE_SITE = 'preview-private';
const videoDir = process.argv[2];
const START = 'getting-started/introduction';
const TARGET = 'guides/webhooks';
const failures = [];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1248/chrome-win64/chrome.exe`,
});

const mockControl = async (state) => {
  const response = await fetch(`${MOCK}/__mock/control`, { method: 'POST', body: JSON.stringify(state) });
  assert.ok(response.ok, `the mock at ${MOCK} accepts test controls`);
};
const targetTitle = await fetch(`${MOCK}/api/public/sites/${SITE}/page?path=${TARGET}`)
  .then((response) => response.json())
  .then((body) => body.data.page.title);

/** A fresh reader with its network traced: documents, page loads (server-function
 *  GETs, by the page path they ask for), and every other API or app request
 *  (events, search, AI, anything that isn't a static asset). */
async function reader(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...options,
    ...(videoDir ? { recordVideo: { dir: videoDir, size: options.viewport ?? { width: 960, height: 600 } } } : {}),
  });
  const page = await context.newPage();
  const trace = { documents: [], pageLoads: [], other: [] };
  page.on('request', (request) => {
    const url = request.url();
    const type = request.resourceType();
    if (type === 'document') trace.documents.push(url);
    else if (request.method() === 'GET' && url.includes('/_serverFn/')) trace.pageLoads.push(decodeURIComponent(url));
    else if (!['script', 'stylesheet', 'image', 'font', 'media', 'manifest'].includes(type))
      trace.other.push({ request: `${request.method()} ${url}`, body: request.postData() ?? '' });
  });
  return { context, page, trace };
}

const pageUrl = (path, site = SITE) => `${APP}/sites/${site}/${path}`;
const loadsOf = (trace, path) => trace.pageLoads.filter((url) => url.includes(path)).length;
const link = (page, path, site = SITE) => page.locator(`nav a[href="/sites/${site}/${path}"]`).first();
/** Handlers exist once React has hydrated the reader. */
const hydrated = (page) =>
  page.waitForFunction(
    () => [...document.querySelectorAll('a[href]')].some((anchor) => Object.keys(anchor).some((key) => key.startsWith('__react'))),
    undefined,
    {
      timeout: 60_000,
    },
  );
const heading = (page) => page.evaluate(() => document.querySelector('main h1')?.textContent ?? '');
/** The page view the open page itself sends once it shows: the reader's own, not a prefetch's. */
const ownPageView = ({ request, body }, openPath) => {
  if (!request.startsWith('POST ') || !/\/events$/.test(new URL(request.slice(5)).pathname)) return false;
  try {
    const { payload } = JSON.parse(body);
    return payload?.name === 'page_view' && payload.path === openPath;
  } catch {
    return false;
  }
};
/** Requests other than page loads since `since` (an index into trace.other), besides the open page's own page view. */
const sideRequests = (trace, since, openPath = START) =>
  trace.other
    .slice(since)
    .filter((entry) => !ownPageView(entry, openPath))
    .map(({ request, body }) => `${request} ${body}`.trim());
/** A finger landing on the link at its centre, optionally moving `drag` px, then lifting. */
const touch = (page, path, drag = 0) =>
  link(page, path).evaluate((anchor, distance) => {
    const box = anchor.getBoundingClientRect();
    const point = (y) => new Touch({ identifier: 1, target: anchor, clientX: box.x + box.width / 2, clientY: y });
    const start = point(box.y + box.height / 2);
    anchor.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [start], changedTouches: [start] }));
    if (distance) {
      const moved = point(box.y + box.height / 2 + distance);
      anchor.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [moved], changedTouches: [moved] }));
    }
    anchor.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [start] }));
  }, drag);

async function scenario(name, run) {
  try {
    await mockControl({});
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

await scenario('hovering a page link prefetches only that page, with no other request, and the click then needs no request', async () => {
  const { context, page, trace } = await reader();
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  // Let the idle next-page preload and anything else at startup settle first.
  await page.waitForTimeout(5000);
  const loadsBefore = trace.pageLoads.length;
  const otherBefore = trace.other.length;
  await link(page, TARGET).hover();
  await page.waitForTimeout(600);
  assert.equal(loadsOf(trace, TARGET), 1, 'the hovered page was loaded once');
  assert.equal(trace.pageLoads.length - loadsBefore, 1, 'and nothing else was loaded');
  assert.deepEqual(sideRequests(trace, otherBefore), [], 'no page view, search, AI or event request');
  const titleBefore = await heading(page);
  await link(page, TARGET).click();
  await page.waitForFunction((title) => document.querySelector('main h1')?.textContent !== title, titleBefore, { timeout: 10_000 });
  assert.equal(loadsOf(trace, TARGET), 1, 'the click reused the prefetched page');
  assert.equal(trace.documents.length, 1, 'no document load');
  await context.close();
});

await scenario('keyboard focus prefetches a page link', async () => {
  const { context, page, trace } = await reader();
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  await link(page, TARGET).focus();
  await page.waitForTimeout(400);
  assert.equal(loadsOf(trace, TARGET), 1);
  await context.close();
});

await scenario('a tap on a page link prefetches it; a touch that scrolls across it does not', async () => {
  const { context, page, trace } = await reader({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  await touch(page, TARGET, 40);
  await page.waitForTimeout(400);
  assert.equal(loadsOf(trace, TARGET), 0, 'a scroll is not intent');
  await touch(page, TARGET);
  await page.waitForTimeout(400);
  assert.equal(loadsOf(trace, TARGET), 1, 'a tap is');
  assert.equal(await page.evaluate(() => location.pathname), `/sites/${SITE}/${START}`, 'touch events alone do not navigate');
  await context.close();
});

await scenario('the pager’s next page loads when the browser is idle, and only that page, with no other request', async () => {
  const { context, page, trace } = await reader();
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  const otherBefore = trace.other.length;
  const next = await page.locator('main a[rel="next"]').getAttribute('href');
  assert.ok(next, 'the page has a next link');
  const nextPath = next.replace(`/sites/${SITE}/`, '').split('?')[0];
  await page.waitForTimeout(5000);
  assert.equal(loadsOf(trace, nextPath), 1, 'the next page was loaded once');
  assert.equal(trace.pageLoads.length, 1, 'no other page was loaded');
  assert.deepEqual(sideRequests(trace, otherBefore), [], 'no page view, search, AI or event request');
  await context.close();
});

await scenario('a private site is never prefetched, and a reader whose access is revoked sees nothing more', async () => {
  const { context, page, trace } = await reader();
  await page.goto(pageUrl(START, PRIVATE_SITE), { waitUntil: 'load' });
  await hydrated(page);
  await link(page, TARGET, PRIVATE_SITE).hover();
  await link(page, TARGET, PRIVATE_SITE).focus();
  await page.waitForTimeout(5000);
  assert.equal(trace.pageLoads.length, 0, 'no hover, focus or idle prefetch');
  await mockControl({ revoked: true });
  await link(page, TARGET, PRIVATE_SITE).click();
  await page.waitForTimeout(3000);
  // The refusal reaches the browser as a 403 (hooks/api/api-error-serialization.ts), so it isn't retried.
  assert.equal(loadsOf(trace, TARGET), 1, 'the click asked the server once');
  assert.notEqual(await heading(page), targetTitle, 'the page did not open');
  assert.ok(!(await page.locator('main').innerText()).includes(targetTitle), 'none of its content is shown');
  assert.equal(trace.documents.length, 1, 'and a refusal is not retried as a document load');
  await context.close();
});

await scenario('Back within the fresh window opens from cache and restores the scroll position', async () => {
  const { context, page, trace } = await reader();
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  await page.evaluate(() => window.scrollTo(0, 400));
  const scrolled = await page.evaluate(() => Math.round(window.scrollY));
  const startTitle = await heading(page);
  await link(page, TARGET).click();
  await page.waitForFunction((title) => document.querySelector('main h1')?.textContent !== title, startTitle, { timeout: 10_000 });
  const loadsBeforeBack = loadsOf(trace, START);
  await page.goBack();
  await page.waitForFunction((title) => document.querySelector('main h1')?.textContent === title, startTitle, { timeout: 10_000 });
  await page.waitForTimeout(300);
  assert.equal(loadsOf(trace, START), loadsBeforeBack, 'Back made no request for the page');
  assert.equal(await page.evaluate(() => Math.round(window.scrollY)), scrolled, 'scroll restored');
  await context.close();
});

await scenario('the browser keeps modified clicks and same-page anchors', async () => {
  const { context, page, trace } = await reader();
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  const popup = context.waitForEvent('page', { timeout: 5000 });
  await link(page, TARGET).click({ modifiers: ['Control'] });
  await popup;
  assert.equal(await page.evaluate(() => location.pathname), `/sites/${SITE}/${START}`, 'Ctrl+click opened a tab, not a navigation here');
  // An in-page anchor (the table of contents): a jump, not a page load.
  const anchor = page.locator('a[href^="#"]:visible').first();
  assert.ok((await anchor.count()) > 0, 'the page has an in-page anchor to check');
  const loads = trace.pageLoads.length;
  // A DOM click: the table of contents may sit under a sticky header in this viewport.
  await anchor.evaluate((element) => element.click());
  await page.waitForTimeout(300);
  assert.equal(trace.pageLoads.length, loads, 'an in-page anchor loads nothing');
  assert.equal(await page.evaluate(() => location.pathname), `/sites/${SITE}/${START}`, 'still on the same page');
  await context.close();
});

await scenario('a refused or failing page keeps its error page, with no document load', async () => {
  for (const status of [403, 500]) {
    const { context, page, trace } = await reader();
    await page.route('**/_serverFn/**', (route) =>
      decodeURIComponent(route.request().url()).includes(TARGET) ? route.fulfill({ status, body: 'no' }) : route.continue(),
    );
    await page.goto(pageUrl(START, PRIVATE_SITE), { waitUntil: 'load' });
    await hydrated(page);
    await link(page, TARGET, PRIVATE_SITE).click();
    await page.waitForTimeout(8000);
    assert.equal(trace.documents.length, 1, `a ${status} is not retried as a document load`);
    assert.notEqual(await heading(page), targetTitle);
    await context.close();
  }
});

await scenario('a link to a missing page shows the not-found page after one request, as the server would', async () => {
  const MISSING = 'guides/no-such-page';
  const { context, page, trace } = await reader();
  // What the server renders for that URL.
  const direct = await context.newPage();
  await direct.goto(pageUrl(MISSING), { waitUntil: 'load' });
  const notFoundTitle = await heading(direct);
  await direct.close();
  assert.notEqual(notFoundTitle, '', 'the server renders a not-found heading');
  trace.documents.length = 0;
  trace.pageLoads.length = 0;

  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  // An in-site link to a page that doesn't exist (a typo in content, say).
  await page.evaluate((href) => {
    const anchor = Object.assign(document.createElement('a'), { href, textContent: 'Missing page' });
    anchor.id = 'missing-link';
    document.querySelector('main')?.prepend(anchor);
  }, `/sites/${SITE}/${MISSING}`);
  await page.locator('#missing-link').click();
  await page.waitForFunction((title) => document.querySelector('main h1')?.textContent === title, notFoundTitle, { timeout: 10_000 });
  await page.waitForTimeout(3000);
  assert.equal(loadsOf(trace, MISSING), 1, 'one request: a 404 is not retried');
  assert.equal(trace.documents.length, 1, 'no document load');
  assert.equal(await page.evaluate(() => location.pathname), `/sites/${SITE}/${MISSING}`);
  await context.close();
});

await scenario('server functions answer same-origin requests only', async () => {
  // A real page-data request, as the reader sends it.
  const { context, page, trace } = await reader();
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  await link(page, TARGET).focus();
  await page.waitForTimeout(500);
  await context.close();
  const url = trace.pageLoads.find((entry) => entry.includes(TARGET));
  assert.ok(url, 'captured a page-data request');
  const send = (headers, init = {}) =>
    fetch(new URL(url.slice(url.indexOf('/_serverFn/')), APP), { headers: { 'x-tsr-serverfn': 'true', ...headers }, redirect: 'manual', ...init });
  const sameOrigin = await send({ 'Sec-Fetch-Site': 'same-origin', Origin: new URL(APP).origin });
  assert.equal(sameOrigin.status, 200, 'a same-origin request is answered');
  for (const headers of [{ 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://elsewhere.example' }]) {
    assert.equal((await send(headers)).status, 403, `refused: ${JSON.stringify(headers)}`);
  }
  const crossSitePost = await send(
    { Origin: 'https://elsewhere.example', 'Content-Type': 'text/plain; x=application/json' },
    { method: 'POST', body: '{}' },
  );
  assert.equal(crossSitePost.status, 403, 'a cross-site POST is refused');
});

// On the private site every navigation asks the server again (nothing is cached),
// so the second attempt below really fails a second time.
await scenario('a gateway failure loads that page from the server once; failing again keeps the error page', async () => {
  const { context, page, trace } = await reader();
  // The browser can't load the page's data (every attempt fails, retries
  // included); the server-rendered page itself is fine.
  await page.route('**/_serverFn/**', (route) =>
    decodeURIComponent(route.request().url()).includes(TARGET)
      ? route.fulfill({ status: 503, body: '<html>Service unavailable</html>', contentType: 'text/html' })
      : route.continue(),
  );
  await page.goto(pageUrl(START, PRIVATE_SITE), { waitUntil: 'load' });
  await hydrated(page);
  await link(page, TARGET, PRIVATE_SITE).click();
  // After the data request's retries give up, the target loads as a document.
  const deadline = Date.now() + 20_000;
  while (trace.documents.length < 2 && Date.now() < deadline) await page.waitForTimeout(200);
  await page.waitForLoadState('load');
  await hydrated(page);
  assert.equal(trace.documents.length, 2, 'one full document load of the target');
  assert.ok(trace.documents[1].endsWith(TARGET), 'the reload was the target page');
  assert.equal(await heading(page), targetTitle, 'the server-rendered page rendered');

  // Away and back: the data fails again, and this time the error page stays.
  await link(page, START, PRIVATE_SITE).click();
  await page.waitForFunction((title) => document.querySelector('main h1')?.textContent !== title, targetTitle, { timeout: 10_000 });
  await link(page, TARGET, PRIVATE_SITE).click();
  await page.waitForTimeout(12_000);
  assert.equal(trace.documents.length, 2, 'no second document load');
  assert.notEqual(await heading(page), targetTitle, 'the error page stayed');
  await context.close();
});

await mockControl({});
await browser.close();
if (failures.length > 0) {
  console.error(`reader navigation: ${failures.length} failed`);
  process.exit(1);
}
console.log('reader navigation: all checks passed');
