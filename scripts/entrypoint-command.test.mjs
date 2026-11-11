import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// One image runs every Nibleaf role. Platforms without a per-service command
// (Coolify Docker Image applications) select the role with NIBLEAF_COMMAND;
// the image's default CMD is `help`. Role names here are passed through to the
// entrypoint's generic `exec "$@"` branch, so no service actually starts.
const posixOnly = { skip: process.platform === 'win32' ? 'needs a POSIX /bin/sh' : false };

const run = (args, env = {}) =>
  spawnSync('/bin/sh', ['docker-entrypoint.sh', ...args], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });

test('NIBLEAF_COMMAND selects the role when the image runs its default CMD', posixOnly, () => {
  const result = run(['help'], { NIBLEAF_COMMAND: 'echo' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '\n');
});

test('an explicit command argument always wins over NIBLEAF_COMMAND', posixOnly, () => {
  const result = run(['printf', 'explicit'], { NIBLEAF_COMMAND: 'echo' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'explicit');
});

test('without NIBLEAF_COMMAND the default CMD is unchanged', posixOnly, () => {
  const withRole = run(['help'], { NIBLEAF_COMMAND: 'echo' });
  const withoutRole = run(['help']);
  assert.notEqual(withoutRole.stdout, withRole.stdout);
});

/** A sandbox image root whose `node` records each call; `migrate deploy` fails
 *  the first FAIL_TIMES times, and starting the server prints a marker. */
const sandbox = (failTimes) => {
  const root = mkdtempSync(join(tmpdir(), 'nibleaf-entrypoint-'));
  copyFileSync('docker-entrypoint.sh', join(root, 'docker-entrypoint.sh'));
  for (const dir of ['packages/database', 'apps/server', 'bin']) mkdirSync(join(root, dir), { recursive: true });
  const log = join(root, 'calls.log');
  const counter = join(root, 'migrate-count');
  writeFileSync(counter, '0');
  const fakeNode = join(root, 'bin', 'node');
  writeFileSync(
    fakeNode,
    `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *"migrate deploy"*)
    n=$(($(cat "${counter}") + 1)); echo "$n" > "${counter}"
    [ "$n" -gt ${failTimes} ] && exit 0
    echo "Error: P1002 timed out acquiring the migration advisory lock" >&2; exit 1 ;;
  *) echo server-started ;;
esac
`,
  );
  chmodSync(fakeNode, 0o755);
  const start = (env = {}) =>
    spawnSync('/bin/sh', ['docker-entrypoint.sh', 'server'], {
      cwd: root,
      encoding: 'utf8',
      env: { PATH: `${join(root, 'bin')}:${process.env.PATH}`, NIBLEAF_MIGRATE_RETRY_DELAY_S: '0', ...env },
    });
  return { start, calls: () => readFileSync(log, 'utf8').trim().split('\n') };
};

test('migrate-on-start applies migrations before the API starts', posixOnly, () => {
  const box = sandbox(0);
  const result = box.start({ NIBLEAF_MIGRATE_ON_START: 'true' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(box.calls()[0], /migrate deploy/);
  assert.match(result.stdout, /server-started/);
});

test('migrate-on-start retries a lock timeout a bounded number of times', posixOnly, () => {
  const box = sandbox(2);
  const result = box.start({ NIBLEAF_MIGRATE_ON_START: 'true', NIBLEAF_MIGRATE_ATTEMPTS: '3' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(box.calls().filter((call) => call.includes('migrate deploy')).length, 3);
  assert.match(result.stdout, /server-started/);
});

test('the API never starts when migrations keep failing', posixOnly, () => {
  const box = sandbox(99);
  const result = box.start({ NIBLEAF_MIGRATE_ON_START: 'true', NIBLEAF_MIGRATE_ATTEMPTS: '2' });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /server-started/);
  assert.match(result.stderr, /migrations failed after 2 attempts/);
});

test('migrate-on-start refuses to run with the advisory lock disabled', posixOnly, () => {
  const box = sandbox(0);
  const result = box.start({ NIBLEAF_MIGRATE_ON_START: 'true', PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: '1' });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /server-started/);
});

test('without NIBLEAF_MIGRATE_ON_START the API starts without migrating', posixOnly, () => {
  const box = sandbox(0);
  const result = box.start();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(box.calls().every((call) => !call.includes('migrate deploy')));
});
