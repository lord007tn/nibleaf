// Real-browser regressions for the capture network guard (capture-env.mjs).
// Each scenario aims a page at an outside host (example.com) through one of the
// ways a route-only guard misses: a redirect (navigation and subresource), a
// WebSocket, DNS prefetch and preconnect, a favicon, and a harness route that
// calls continue(). Pass: Chromium's own network log shows no connection or
// resolved address outside loopback. The pages come from a loopback listener
// on a free port (an in-process fixture, not a dev stack).
//
//   node tests/integration/lib/capture-network.browser.mjs
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchLocalOnlyBrowser } from './capture-env.mjs';

const OUTSIDE = 'example.com';
const html = (body) => `<!doctype html><html><head><meta charset="utf-8">${body}</head><body>fixture</body></html>`;
const pages = {
  '/ok': html(''),
  '/nav-redirect': null,
  '/img-redirect': null,
  '/subresource-redirect': html('<img src="/img-redirect">'),
  '/websocket': html(`<script>try { new WebSocket('wss://${OUTSIDE}/socket'); } catch {}</script>`),
  '/prefetch': html(`<link rel="dns-prefetch" href="//${OUTSIDE}"><link rel="preconnect" href="https://${OUTSIDE}">`),
  '/favicon': html(`<link rel="icon" href="https://${OUTSIDE}/favicon.ico">`),
  '/harness': html(`<img src="https://${OUTSIDE}/harness.png">`),
};
const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://fixture').pathname;
  if (path === '/nav-redirect') return response.writeHead(301, { location: `https://${OUTSIDE}/` }).end();
  if (path === '/img-redirect') return response.writeHead(301, { location: `https://${OUTSIDE}/pixel.png` }).end();
  const body = pages[path];
  if (body === undefined) return response.writeHead(404).end();
  response.writeHead(200, { 'content-type': 'text/html' }).end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
const origin = `http://127.0.0.1:${port}`;

/** Every address outside loopback in a NetLog file: a resolved name or a connection. */
const outsideAddresses = (log) =>
  [
    ...new Set([...log.matchAll(/"(?:address|remote_address|address_list)"\s*:\s*"?\[?"?([0-9]{1,3}(?:\.[0-9]{1,3}){3})/g)].map((match) => match[1])),
  ].filter((address) => address !== '127.0.0.1' && address !== '0.0.0.0');

const scenarios = [
  ['navigation redirect to an outside host', async (page) => page.goto(`${origin}/nav-redirect`).catch(() => undefined)],
  ['subresource redirect to an outside host', async (page) => page.goto(`${origin}/subresource-redirect`)],
  ['WebSocket to an outside host', async (page) => page.goto(`${origin}/websocket`)],
  ['dns-prefetch and preconnect to an outside host', async (page) => page.goto(`${origin}/prefetch`)],
  ['favicon on an outside host', async (page) => page.goto(`${origin}/favicon`)],
  [
    'a harness route that calls continue()',
    async (page) => {
      await page.route('**/*', (route) => route.continue());
      await page.goto(`${origin}/harness`);
    },
  ],
];

const results = [];
const scratch = await mkdtemp(join(tmpdir(), 'capture-network-'));
try {
  for (const [name, run] of scenarios) {
    const netLog = join(scratch, `${results.length}.json`);
    const local = await launchLocalOnlyBrowser({
      allowedHosts: [`127.0.0.1:${port}`],
      customDomains: { 'docs.capture-fixture.test': port },
      launch: { args: [`--log-net-log=${netLog}`, '--net-log-capture-mode=Default'] },
    });
    const context = await local.browser.newContext();
    const page = await context.newPage();
    await run(page);
    await page.waitForTimeout(1500);
    let guardError = null;
    try {
      await local.close();
    } catch (error) {
      guardError = error instanceof Error ? error.message.split('\n')[0] : String(error);
    }
    const outside = outsideAddresses(await readFile(netLog, 'utf8'));
    results.push({ name, outside, attempted: [...local.attempted], guardError });
  }

  // The allowed paths still work: the local origin and a custom domain mapped to it.
  const local = await launchLocalOnlyBrowser({ allowedHosts: [`127.0.0.1:${port}`], customDomains: { 'docs.capture-fixture.test': port } });
  const context = await local.browser.newContext();
  const page = await context.newPage();
  // No way around the guard: no browser-level CDP, the context leads back only to
  // the facade, and page-level CDP is refused.
  assert.equal(typeof local.browser.newBrowserCDPSession, 'undefined', 'the facade has no newBrowserCDPSession');
  assert.equal(context.browser(), local.browser, 'context.browser() is the facade');
  assert.equal(typeof context.browser().newBrowserCDPSession, 'undefined');
  await assert.rejects(context.newCDPSession(page), /not available in captures/);
  const direct = await page.goto(`${origin}/ok`);
  const mapped = await page.goto('http://docs.capture-fixture.test/ok');
  await local.close();
  results.push({ name: 'allowed: local origin and mapped custom domain', statuses: [direct?.status(), mapped?.status()] });
} finally {
  server.close();
  await rm(scratch, { recursive: true, force: true });
}

console.log(JSON.stringify(results, null, 2));
for (const result of results.slice(0, -1)) assert.deepEqual(result.outside, [], `${result.name}: reached ${result.outside.join(', ')}`);
assert.deepEqual(results.at(-1)?.statuses, [200, 200], 'allowed hosts load');
// Where Playwright can see the attempt, the guard records it and fails the run.
for (const name of [
  'navigation redirect to an outside host',
  'subresource redirect to an outside host',
  'WebSocket to an outside host',
  'a harness route that calls continue()',
]) {
  const result = results.find((candidate) => candidate.name === name);
  assert.ok(result && result.attempted.length > 0 && result.guardError, `${name}: recorded and failed the run`);
}
console.log('capture network guard: no connection left this machine in any scenario');
