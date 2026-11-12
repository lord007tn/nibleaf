// Shared settings for the browser capture scripts under tests/integration.
//
// The rule for every capture: take the dev-stack lock (`acquireDevstackLock`),
// and give each browser context a default-deny network (`localOnlyNetwork`)
// allowing only the local app, its read-only proxy and any fixture origin. Open
// a site by its custom domain through `localHostArgs` so the local app serves
// it. Fail the run if anything outside was attempted, and put the attempted
// count (0) in the PR body.
import { rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The Chromium to launch: an explicit executable when one is configured
 * (PLAYWRIGHT_CHROMIUM_EXECUTABLE, CHROME_PATH, or the older CHROMIUM_PATH),
 * otherwise undefined, so Playwright launches the browser it installed.
 */
export const chromiumExecutable = () =>
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || process.env.CHROME_PATH || process.env.CHROMIUM_PATH || undefined;

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

/**
 * Chromium launch arguments that resolve the given hosts to local ports, so a
 * capture can open a site by its custom domain (`docs.example.com`) and still be
 * served by the local app: `localHostArgs({ 'docs.example.com': 4310 })`.
 * Pass them in `chromium.launch({ args })`.
 */
export const localHostArgs = (hosts) => {
  const rules = Object.entries(hosts).map(([host, port]) => `MAP ${host.toLowerCase()} 127.0.0.1:${port}`);
  return rules.length > 0 ? [`--host-resolver-rules=${rules.join(',')}`] : [];
};

/**
 * Default-deny network for a browser context: only requests whose host
 * (`name:port`, as in `new URL(url).host`) is on the allowlist go through:
 * the local app, its read-only proxy, a fixture origin. Every other request is
 * aborted before it leaves the machine and recorded, so a redirect to a
 * production domain, a third-party script or a beacon can never reach
 * production. Call before the first navigation; then `assertNoneAttempted()`
 * fails the run if anything was attempted, and `attempted` is the evidence for
 * the PR body (it should be empty).
 *
 * Requests a page route answers (`page.route`, an interception harness) are
 * handled there first and never reach this rule.
 */
export async function localOnlyNetwork(context, allowedHosts) {
  const allowed = new Set(allowedHosts.map((host) => host.toLowerCase()));
  const attempted = [];
  await context.route('**/*', (route) => {
    const request = route.request();
    let host = '';
    try {
      host = new URL(request.url()).host.toLowerCase();
    } catch {
      // An address that doesn't parse is never allowed.
    }
    if (host && allowed.has(host)) return route.continue();
    const url = request.url();
    attempted.push(`${request.method()} ${url.length > 200 ? `${url.slice(0, 200)}…` : url}`);
    return route.abort('blockedbyclient');
  });
  return {
    attempted,
    assertNoneAttempted() {
      if (attempted.length > 0) {
        throw new Error(`The capture tried to reach ${attempted.length} address(es) outside the local stack:\n${attempted.join('\n')}`);
      }
    },
  };
}
