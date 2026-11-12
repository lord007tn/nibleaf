// Shared settings for the browser capture scripts under tests/integration.
//
// The rule for every capture: take the dev-stack lock (`acquireDevstackLock`)
// and launch the browser with `withLocalOnlyBrowser` (or
// `launchLocalOnlyBrowser`). Chromium itself then resolves only loopback and the
// custom domains mapped to the local app, and a closed proxy stops anything
// else, so redirects, WebSockets, prefetches and favicons stay on this machine
// too. Every context is guarded for accounting: attempts outside the allowed
// hosts fail the run, and their count (0) goes in the PR body.
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The Chromium to launch: an explicit executable when one is configured
 * (PLAYWRIGHT_CHROMIUM_EXECUTABLE, CHROME_PATH, or the older CHROMIUM_PATH),
 * otherwise undefined, so Playwright launches the browser it installed.
 */
const chromiumExecutable = () => process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROME_PATH || process.env.CHROMIUM_PATH || undefined;

/** Where the dev-stack lock lives: NIBLEAF_DEVSTACK_LOCK, or a directory in the OS temp dir. */
const devstackLockPath = () => process.env.NIBLEAF_DEVSTACK_LOCK || join(tmpdir(), 'nibleaf-devstack.lock');

/**
 * Take the machine-wide dev-stack lock: a directory created atomically, so only
 * one capture or dev stack runs at a time. Throws (EEXIST) when another run
 * holds it; the lock is never borrowed or removed unless this call created it.
 *
 * The lock is released however the run ends. `release()` is idempotent; an
 * interrupt (Ctrl+C, SIGTERM) first runs `onInterrupt` (stop the services and
 * browser the script started), then releases and exits; and a process that
 * exits without releasing removes it on the way out. The interrupt handlers
 * are installed before the lock is taken, so there is no moment where a held
 * lock has no way to be released. Launch Playwright with `handleSIGINT: false`
 * (and SIGTERM/SIGHUP) so `onInterrupt` closes the browser itself.
 */
export async function acquireDevstackLock(owner, { onInterrupt } = {}) {
  const path = devstackLockPath();
  let held = false;
  const releaseNow = () => {
    if (!held) return;
    held = false;
    rmSync(path, { recursive: true, force: true });
  };
  let interrupted = false;
  const onSignal = (signal) => {
    if (interrupted) return;
    interrupted = true;
    void (async () => {
      try {
        await onInterrupt?.();
      } catch (error) {
        console.error('Cleanup after interrupt failed:', error);
      } finally {
        releaseNow();
        process.exit(signal === 'SIGINT' ? 130 : 143);
      }
    })();
  };
  const detach = () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
    process.off('exit', releaseNow);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('exit', releaseNow);
  try {
    await mkdir(path); // EEXIST while another run holds the lock; never borrow it.
    held = true;
    await writeFile(join(path, 'owner.txt'), `${owner}\npid=${process.pid}\nstarted=${new Date().toISOString()}\n`);
  } catch (error) {
    releaseNow();
    detach();
    throw error;
  }
  return {
    path,
    release: async () => {
      detach();
      releaseNow();
    },
  };
}

const DEFAULT_PORTS = { 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' };

/** `hostname:port` with the scheme's default port written out, or '' for an address that doesn't parse. */
export const hostKey = (address) => {
  try {
    const url = new URL(address);
    return `${url.hostname.toLowerCase()}:${url.port || DEFAULT_PORTS[url.protocol] || ''}`;
  } catch {
    return '';
  }
};

/**
 * An allowed host as `hostname:port` (`localhost:4310`). The port is required
 * and loopback aliases are not merged: `localhost:4310` doesn't allow
 * `127.0.0.1:4310`. `0.0.0.0` is never allowed.
 */
export const allowedHostKey = (host) => {
  const match = /^([a-z0-9.-]+|\[[0-9a-f:]+\]):(\d{1,5})$/i.exec(host.trim());
  if (!match) throw new Error(`Allowed host "${host}" must be hostname:port`);
  const hostname = (match[1] ?? '').toLowerCase();
  if (hostname === '0.0.0.0' || hostname === '[::]') throw new Error(`"${host}" listens on every interface; allow a loopback name instead`);
  return `${hostname}:${Number(match[2])}`;
};

const LOOPBACK = ['localhost', '127.0.0.1'];

/**
 * Chromium launch arguments that keep the browser on this machine, beneath
 * Playwright, so redirects, WebSockets, DNS prefetch, preconnect and favicons
 * are covered as well as ordinary requests:
 * - host resolution: each custom domain (`{ 'docs.example.com': 4310 }`) maps
 *   to the local app, loopback resolves as usual, and every other name fails
 *   to resolve (`MAP * ~NOTFOUND`), even with no custom domains;
 * - a proxy on a closed local port, which only loopback and the mapped domains
 *   bypass, so anything that still resolves can't connect out.
 */
export const localOnlyBrowserArgs = (customDomains = {}) => {
  const domains = Object.entries(customDomains).map(([host, port]) => {
    const name = host.trim().toLowerCase();
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) throw new Error(`Custom domain "${host}" must be a hostname`);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`Custom domain "${host}" needs a local port`);
    return [name, port];
  });
  const rules = [...domains.map(([name, port]) => `MAP ${name} 127.0.0.1:${port}`), 'MAP * ~NOTFOUND', ...LOOPBACK.map((name) => `EXCLUDE ${name}`)];
  return [
    `--host-resolver-rules=${rules.join(', ')}`,
    '--proxy-server=127.0.0.1:9',
    `--proxy-bypass-list=${[...LOOPBACK, ...domains.map(([name]) => name)].join(';')}`,
  ];
};

/**
 * Accounting for one browser context, on top of the network-level guard: every
 * request, WebSocket and redirect aimed outside `allowed` is recorded in
 * `attempted` (requests and sockets are also stopped here). Harness routes on
 * the context or its pages get a route whose `continue()` falls back to this
 * guard, so a harness can answer a request but never send it on unchecked.
 */
const guardContext = async (context, allowed, attempted) => {
  const record = (what) => {
    const line = what.length > 220 ? `${what.slice(0, 220)}…` : what;
    if (!attempted.includes(line)) attempted.push(line);
  };
  const isAllowed = (address) => allowed.has(hostKey(address));
  await context.route('**/*', (route) => {
    const request = route.request();
    if (isAllowed(request.url())) return route.continue();
    record(`${request.method()} ${request.url()}`);
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/, (socket) => {
    if (isAllowed(socket.url())) return socket.connectToServer();
    record(`WEBSOCKET ${socket.url()}`);
    return socket.close();
  });
  context.on('response', (response) => {
    const status = response.status();
    const location = response.headers().location;
    if (status < 300 || status >= 400 || !location) return;
    const target = new URL(location, response.url()).href;
    if (!isAllowed(target)) record(`REDIRECT ${response.url()} -> ${target}`);
  });
  context.on('requestfailed', (request) => {
    if (!isAllowed(request.url())) record(`${request.method()} ${request.url()}`);
  });
  // A harness route's continue() becomes fallback(): the guard above still decides.
  const harnessRoute = (handler) => (route, request) =>
    handler(
      new Proxy(route, {
        get: (target, key) => (key === 'continue' ? (options) => target.fallback(options) : Reflect.get(target, key, target)),
      }),
      request,
    );
  const contextRoute = context.route.bind(context);
  context.route = (url, handler, options) => contextRoute(url, harnessRoute(handler), options);
  const newPage = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await newPage(...args);
    const pageRoute = page.route.bind(page);
    page.route = (url, handler, options) => pageRoute(url, harnessRoute(handler), options);
    return page;
  };
  return context;
};

/**
 * Launch Chromium for a capture with the network kept local: the launch
 * arguments above, and every context from `browser.newContext` guarded and
 * kept free of service workers. `allowedHosts` are the local app, its
 * read-only proxy and any fixture origin (`hostname:port`); `customDomains`
 * map to the local app and are allowed on port 80. `close()` closes the
 * browser and fails if anything outside was attempted; `attempted` is the
 * evidence for the PR body (it should be empty).
 */
export async function launchLocalOnlyBrowser({ allowedHosts = [], customDomains = {}, launch = {} } = {}) {
  const { chromium } = await import('playwright-core');
  const allowed = new Set([...allowedHosts.map(allowedHostKey), ...Object.keys(customDomains).map((host) => `${host.toLowerCase()}:80`)]);
  const attempted = [];
  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutable(),
    ...launch,
    args: [...(launch.args ?? []), ...localOnlyBrowserArgs(customDomains)],
  });
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (options = {}) => guardContext(await newContext({ ...options, serviceWorkers: 'block' }), allowed, attempted);
  // `browser.newPage()` makes its own context; give it a guarded one, closed with the page.
  browser.newPage = async (options = {}) => {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    page.on('close', () => {
      context.close().catch(() => undefined);
    });
    return page;
  };
  return {
    browser,
    attempted,
    async close() {
      await browser.close().catch(() => undefined);
      if (attempted.length > 0) {
        throw new Error(`The capture tried to reach ${attempted.length} address(es) outside the local stack:\n${attempted.join('\n')}`);
      }
    },
  };
}

/**
 * `launchLocalOnlyBrowser`, run `fn({ browser, attempted })`, close. Anything
 * attempted outside fails the run after the browser closes; when `fn` itself
 * failed, its error is the one thrown and the attempts are printed with it.
 */
export async function withLocalOnlyBrowser(options, fn) {
  const local = await launchLocalOnlyBrowser(options);
  let failure;
  try {
    return await fn({ browser: local.browser, attempted: local.attempted });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (failure) {
      await local.browser.close().catch(() => undefined);
      if (local.attempted.length > 0) console.error(`Also attempted outside the local stack:\n${local.attempted.join('\n')}`);
    } else {
      await local.close();
    }
  }
}
