import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function snapshot(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return Object.fromEntries(
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const file = join(entry.parentPath, entry.name);
          return [relative(directory, file).replaceAll('\\', '/'), { hash: hash(await readFile(file)), mtime: (await stat(file)).mtimeMs }];
        }),
    ),
  );
}

/** A reversible source edit through Vite's actual hot-update hook. */
export async function checkDevGeneration(root, scratch, browser, registerCleanup, createServer) {
  const { dashboardCatalogPlugin } = await import(pathToFileURL(join(root, 'apps/app/scripts/dashboard-catalog-plugin.ts')).href);
  const { generateDashboardCatalogs } = await import(pathToFileURL(join(root, 'packages/i18n/scripts/generate-dashboard-catalogs.mjs')).href);
  const output = join(root, 'packages/i18n/src/generated/dashboard');
  const source = join(root, 'packages/i18n/messages/ar.json');
  const module = join(output, 'messages/ar.js');
  const original = await readFile(source);
  const before = await snapshot(output);
  const cancel = JSON.parse(original.toString('utf8')).common_cancel;
  const changedText = `${cancel} [fixture regeneration]`;
  const needle = `${JSON.stringify('common_cancel')}: ${JSON.stringify(cancel)}`;
  assert.ok(original.toString('utf8').includes(needle));
  const changedSource = original.toString('utf8').replace(needle, `${JSON.stringify('common_cancel')}: ${JSON.stringify(changedText)}`);
  const temporary = `${source}.ui627-${process.pid}.tmp`;
  let stopping;
  let sourcePublication = Promise.resolve();
  // Restoration queues after any edit already in flight when interrupted.
  const replaceSource = (bytes) => {
    const next = sourcePublication.then(async () => {
      if (stopping && !Buffer.from(bytes).equals(original)) throw new Error('Fixture edit interrupted');
      if ((await readFile(source)).equals(Buffer.from(bytes))) return;
      try {
        await writeFile(temporary, bytes, { flag: 'wx' });
        await rename(temporary, source);
      } finally {
        await rm(temporary, { force: true });
      }
    });
    sourcePublication = next.catch(() => undefined);
    return next;
  };
  await writeFile(join(scratch, 'original-ar.json'), original);
  let server;
  let context;
  let sampling = true;
  let reader = Promise.resolve();
  const stop = () => {
    stopping ??= (async () => {
      sampling = false;
      await reader;
      try {
        await context?.close();
        await server?.close();
      } finally {
        await replaceSource(original);
        await generateDashboardCatalogs();
      }
    })();
    return stopping;
  };
  registerCleanup(stop);
  let changed;
  const observations = [];
  try {
    const harness = join(scratch, 'dev-generation');
    await mkdir(harness, { recursive: true });
    await writeFile(
      join(harness, 'index.html'),
      `<output id="value"></output><script type="module">import * as ar from '/@fs/${module.replaceAll('\\', '/')}'; document.querySelector('#value').textContent = ar.common_cancel();</script>`,
    );
    server = await createServer({
      configFile: false,
      root: harness,
      plugins: [dashboardCatalogPlugin()],
      server: { host: '127.0.0.1', port: 4310, strictPort: true },
    });
    assert.ok(!stopping, 'Capture was interrupted before dev startup');
    await server.listen();
    assert.deepEqual(await snapshot(output), before, 'Dev startup preserves every unchanged output and mtime');
    context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('http://localhost:4310');
    await page.waitForFunction((expected) => document.querySelector('#value')?.textContent === expected, cancel);
    reader = (async () => {
      while (sampling && observations.length < 600) {
        try {
          observations.push(hash(await readFile(module)));
        } catch (error) {
          observations.push(`read-error:${error.code}`);
        }
        await delay(25);
      }
    })();
    await replaceSource(changedSource);
    await page.waitForFunction((expected) => document.querySelector('#value')?.textContent === expected, changedText, { timeout: 15_000 });
    const after = await snapshot(output);
    changed = Object.keys(after).filter((file) => after[file].hash !== before[file]?.hash || after[file].mtime !== before[file]?.mtime);
    assert.deepEqual(changed, ['messages/ar.js'], 'Only the edited locale is republished');
    sampling = false;
    await reader;
    observations.push(after['messages/ar.js'].hash);
    assert.ok(
      observations.every((value) => value === before['messages/ar.js'].hash || value === after['messages/ar.js'].hash),
      'Concurrent reads see complete old or new modules',
    );
  } finally {
    await stop();
  }
  assert.equal(hash(await readFile(source)), hash(original), 'Catalog source restored byte-for-byte');
  const restored = await snapshot(output);
  assert.deepEqual(
    Object.fromEntries(Object.entries(restored).map(([file, value]) => [file, value.hash])),
    Object.fromEntries(Object.entries(before).map(([file, value]) => [file, value.hash])),
    'Generated module bytes restored',
  );
  return { changed, sourceRestored: true, outputsRestored: true, atomicReadSamples: observations.length };
}
