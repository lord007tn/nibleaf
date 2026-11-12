// Shared settings for the browser capture scripts under tests/integration.
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
