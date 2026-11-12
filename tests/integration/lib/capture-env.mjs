// Shared settings for the browser capture scripts under tests/integration.
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
 * one capture or dev stack runs at a time. Throws when another run holds it.
 * The returned release removes the lock only if this call created it.
 */
export async function acquireDevstackLock(owner) {
  const path = devstackLockPath();
  await mkdir(path); // EEXIST while another run holds the lock; never borrow it.
  let held = true;
  await writeFile(join(path, 'owner.txt'), `${owner}\npid=${process.pid}\nstarted=${new Date().toISOString()}\n`);
  return {
    path,
    release: async () => {
      if (!held) return;
      held = false;
      await rm(path, { recursive: true, force: true });
    },
  };
}
