// Run against the real app/API/worker, using only a designated disposable database.
// NIBLEAF_BEFORE_APP / NIBLEAF_BEFORE_API optionally name preserved main builds.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { getDb } from '../../../packages/database/src/client.ts';
import { acquireDevstackLock, chromiumExecutable } from '../lib/capture-env.mjs';
import { journey } from './journey.mjs';

const root = resolve(import.meta.dirname, '../../..');
const output = resolve(root, '.github/assets/fix-editor-p2-batch');
assert.equal(new URL(process.env.POSTGRES_URL).pathname.slice(1), process.env.NIBLEAF_CAPTURE_DATABASE, 'explicit disposable database required');
assert.ok(process.env.NIBLEAF_CAPTURE_DATABASE?.includes('editor_p2'));
assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK, 'Set the shared machine-wide NIBLEAF_DEVSTACK_LOCK');
let lock;
for (;;) {
  try {
    lock = await acquireDevstackLock('fix/editor-p2-batch');
    break;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    console.log('Waiting for the shared dev-stack lock.');
    await new Promise((done) => setTimeout(done, 5000));
  }
}
const db = getDb({ connectionString: process.env.POSTGRES_URL });
const children = new Set();
const logs = [];
let browser;
let session;
const measurements = [];
await mkdir(output, { recursive: true });
await mkdir(resolve(root, '.tmp/editor-p2'), { recursive: true });

function start(name, entry, port) {
  const log = createWriteStream(resolve(root, `.tmp/editor-p2/${name}.log`));
  logs.push(log);
  const child = spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', entry], {
    cwd: root,
    env: { ...process.env, PORT: String(port), SEARCH_RUNTIME: 'legacy', WORKER_QUEUES: 'publish' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  children.add(child);
  return child;
}
async function stop(child) {
  if (child.exitCode === null) {
    child.kill();
    await new Promise((done) => child.once('exit', done));
  }
  children.delete(child);
}
async function ready(url) {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* Booting. */
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error(`Not ready: ${url}`);
}
try {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'demo@nibleaf.test' } });
  const member = await db.member.findFirstOrThrow({ where: { userId: user.id } });
  const token = randomUUID();
  session = await db.session.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + 3_600_000), activeOrganizationId: member.organizationId },
  });
  const signed = encodeURIComponent(`${token}.${createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(token).digest('base64')}`);
  browser = await chromium.launch({ executablePath: await chromiumExecutable(), headless: true });
  const worker = start('worker', 'apps/worker/dist/index.mjs', 4312);
  const phases = process.env.NIBLEAF_BEFORE_APP ? ['before', 'after'] : ['after'];
  for (const phase of phases) {
    const before = phase === 'before';
    const api = start(`${phase}-api`, before ? process.env.NIBLEAF_BEFORE_API : 'apps/server/dist/index.mjs', 4311);
    const app = start(`${phase}-app`, before ? process.env.NIBLEAF_BEFORE_APP : 'apps/app/.output/server/index.mjs', 4310);
    await ready('http://localhost:4311/health');
    await ready('http://localhost:4310/');
    for (const locale of ['en', 'ar'])
      for (const width of [1440, 390]) {
        const context = await browser.newContext({
          viewport: { width, height: width === 390 ? 844 : 900 },
          isMobile: width === 390,
          hasTouch: width === 390,
          recordVideo: { dir: resolve(root, '.tmp/editor-p2/videos'), size: { width, height: width === 390 ? 844 : 900 } },
          locale,
          reducedMotion: 'reduce',
        });
        await context.addCookies([
          { name: 'better-auth.session_token', value: signed, url: 'http://localhost:4310', httpOnly: true, sameSite: 'Lax' },
          { name: 'PARAGLIDE_LOCALE', value: locale, url: 'http://localhost:4310' },
        ]);
        measurements.push(await journey({ db, context, member, phase, locale, width, output }));
        await context.close();
      }
    await stop(app);
    await stop(api);
  }
  await stop(worker);
  await writeFile(resolve(output, 'measurements.json'), `${JSON.stringify(measurements, null, 2)}\n`);
  console.log(`${measurements.length} journeys passed. Measurements saved.`);
} finally {
  await browser?.close();
  for (const child of children) await stop(child);
  if (session) await db.session.delete({ where: { id: session.id } });
  await db.$disconnect();
  for (const log of logs) log.end();
  await lock.release();
}
