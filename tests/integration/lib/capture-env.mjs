import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

/** Capture scripts share the machine's app/server lock, supplied by the caller. */
export async function acquireDevstackLock() {
  const path = process.env.NIBLEAF_DEVSTACK_LOCK;
  if (!path) throw new Error('Set NIBLEAF_DEVSTACK_LOCK to the shared machine lock directory.');
  const owner = `${process.pid} ${randomUUID()}`;
  for (;;) {
    try {
      await mkdir(path);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      console.log('Waiting for the shared dev-stack lock.');
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  await writeFile(join(path, 'owner.txt'), owner);
  return async () => {
    if ((await readFile(join(path, 'owner.txt'), 'utf8')) !== owner) throw new Error('Dev-stack lock ownership changed.');
    await unlink(join(path, 'owner.txt'));
    await rmdir(path);
  };
}

/** Prefer an explicit executable, then Playwright's installed browser. */
export async function chromiumExecutable() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache =
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
    (process.platform === 'win32' ? join(process.env.LOCALAPPDATA, 'ms-playwright') : join(homedir(), '.cache/ms-playwright'));
  const versions = (await readdir(cache))
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
  for (const version of versions) {
    const executable = join(
      cache,
      version,
      process.platform === 'win32'
        ? 'chrome-win64/chrome.exe'
        : process.platform === 'darwin'
          ? 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'
          : 'chrome-linux/chrome',
    );
    if (existsSync(executable)) return executable;
  }
  throw new Error('Install Playwright Chromium or set CHROMIUM_PATH.');
}
