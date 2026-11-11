import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

// One image runs every Nibleaf role. Platforms without a per-service command
// (Coolify Docker Image applications) select the role with NIBLEAF_COMMAND;
// the image's default CMD is `help`. The role names here are passed through to
// the entrypoint's generic `exec "$@"` branch so no service actually starts.
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
