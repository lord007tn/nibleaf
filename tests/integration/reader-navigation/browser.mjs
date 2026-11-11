// Real-browser check of the published reader's client-side navigation (READER-05b):
// intent prefetch for plain `<a>` page links, the pager's next page on idle,
// Back from cache, links the browser must keep, and the full-page fallback when
// a client navigation fails. A prefetch must never count as a page view.
//
// Runs against a production build of the app (:4310) with the dependency-free
// public site mock standing in for the API. See README.md here.
//   node tests/integration/reader-navigation/browser.mjs [videoDir]
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const APP = process.env.APP_URL ?? 'http://localhost:4310';
const SITE = process.env.SITE_ID ?? 'preview-harbor';
const videoDir = process.argv[2];
const START = 'getting-started/introduction';
const TARGET = 'guides/webhooks';
const failures = [];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium-1248/chrome-win64/chrome.exe`,
});

/** A fresh reader with its network traced: page loads (server-function GETs, by
 *  the page path they ask for), documents, and analytics events with their bodies. */
async function reader(options = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ...options,
    ...(videoDir ? { recordVideo: { dir: videoDir, size: options.viewport ?? { width: 960, height: 600 } } } : {}),
  });
  const page = await context.newPage();
  const trace = { documents: [], pageLoads: [], events: [] };
  page.on('request', (request) => {
    const url = request.url();
    if (request.resourceType() === 'document') trace.documents.push(url);
    else if (url.includes('/_serverFn/')) trace.pageLoads.push(decodeURIComponent(url));
    else if (request.method() === 'POST' && /\/events(\?|$)/.test(new URL(url).pathname)) trace.events.push(request.postData() ?? '');
  });
  return { context, page, trace };
}

const pageUrl = (path) => `${APP}/sites/${SITE}/${path}`;
const loadsOf = (trace, path) => trace.pageLoads.filter((url) => url.includes(path)).length;
const link = (page, path) => page.locator(`nav a[href="/sites/${SITE}/${path}"]`).first();
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

async function scenario(name, run) {
  try {
    await run();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL ${name}: ${error.message}`);
  }
}

await scenario('hovering a page link prefetches it, without a page view, and the click then needs no request', async () => {
  const { context, page, trace } = await reader();
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  const eventsBefore = trace.events.length;
  await link(page, TARGET).hover();
  await page.waitForTimeout(600);
  assert.equal(loadsOf(trace, TARGET), 1, 'the hovered page was loaded once');
  assert.ok(
    trace.events.slice(eventsBefore).every((body) => !body.includes(TARGET)),
    'no analytics event mentions the prefetched page',
  );
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

await scenario('a touch on a page link starts its load before the tap completes', async () => {
  const { context, page, trace } = await reader({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  await link(page, TARGET).dispatchEvent('touchstart');
  await page.waitForTimeout(400);
  assert.equal(loadsOf(trace, TARGET), 1);
  assert.equal(await page.evaluate(() => location.pathname), `/sites/${SITE}/${START}`, 'a touch alone does not navigate');
  await context.close();
});

await scenario('the pager’s next page loads when the browser is idle, and only that page', async () => {
  const { context, page, trace } = await reader();
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  const next = await page.locator('main a[rel="next"]').getAttribute('href');
  assert.ok(next, 'the page has a next link');
  const nextPath = next.replace(`/sites/${SITE}/`, '').split('?')[0];
  await page.waitForTimeout(5000);
  assert.equal(loadsOf(trace, nextPath), 1, 'the next page was loaded once');
  assert.equal(trace.pageLoads.length, 1, 'no other page was loaded');
  assert.ok(
    trace.events.every((body) => !body.includes(nextPath)),
    'no analytics event mentions it',
  );
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
  if (await anchor.count()) {
    const loads = trace.pageLoads.length;
    // A DOM click: the table of contents may sit under a sticky header in this viewport.
    await anchor.evaluate((element) => element.click());
    await page.waitForTimeout(300);
    assert.equal(trace.pageLoads.length, loads, 'an in-page anchor loads nothing');
    assert.equal(await page.evaluate(() => location.pathname), `/sites/${SITE}/${START}`, 'still on the same page');
  }
  await context.close();
});

await scenario('a failed client navigation loads that page from the server once', async () => {
  const { context, page, trace } = await reader();
  // The browser can't load the page's data (every attempt fails, retries
  // included); the server-rendered page itself is fine.
  await page.route('**/_serverFn/**', (route) =>
    decodeURIComponent(route.request().url()).includes(TARGET) ? route.fulfill({ status: 500, body: 'unavailable' }) : route.continue(),
  );
  await page.goto(pageUrl(START), { waitUntil: 'load' });
  await hydrated(page);
  await link(page, TARGET).click();
  // After the data request's retries give up, the target loads as a document.
  const deadline = Date.now() + 20_000;
  while (trace.documents.length < 2 && Date.now() < deadline) await page.waitForTimeout(200);
  await page.waitForLoadState('load');
  await hydrated(page);
  await page.waitForTimeout(1500);
  assert.equal(trace.documents.length, 2, 'one full document load of the target, and no more');
  assert.ok(trace.documents[1].endsWith(TARGET), 'the reload was the target page');
  assert.notEqual(await heading(page), '', 'the page rendered');
  await context.close();
});

await browser.close();
if (failures.length > 0) {
  console.error(`reader navigation: ${failures.length} failed`);
  process.exit(1);
}
console.log('reader navigation: all checks passed');
