import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const template = readFileSync(new URL('./install.sh', import.meta.url), 'utf8');
for (const scenario of [
  'architecture',
  'daemon-architecture',
  'env',
  'compose',
  'containers',
  'volumes',
  'unlabelled',
  'inspection',
  'decline',
  'fresh',
  'smtp',
]) {
  test(`installer: ${scenario}`, { skip: process.platform === 'win32' }, () => {
    const root = mkdtempSync(join(tmpdir(), 'nibleaf-install-test-'));
    try {
      const bin = join(root, 'bin');
      const target = join(root, 'install');
      mkdirSync(bin);
      mkdirSync(target);
      const mock = (name, body) => {
        const path = join(bin, name);
        writeFileSync(path, `#!/bin/sh\n${body}\n`);
        chmodSync(path, 0o755);
      };
      mock('uname', `echo ${scenario === 'architecture' ? 'aarch64' : 'x86_64'}`);
      mock(
        'docker',
        `case "$*" in
        'compose version') exit 0 ;;
        version*) echo ${scenario === 'daemon-architecture' ? 'arm64' : 'amd64'} ;;
        ps*) ${scenario === 'containers' ? 'echo existing' : 'exit 0'} ;;
        'volume ls -q --filter label='*) ${scenario === 'inspection' ? 'exit 1' : scenario === 'volumes' ? 'echo retained' : 'exit 0'} ;;
        'volume ls'*) ${scenario === 'unlabelled' ? 'echo retained' : 'exit 0'} ;;
        *) exit 0 ;;
      esac`,
      );
      mock('curl', 'while [ "$1" != "-o" ]; do shift; done; printf fixture > "$2"');
      if (scenario === 'env') writeFileSync(join(target, '.env'), 'preserved');
      if (scenario === 'compose') writeFileSync(join(target, 'compose.yaml'), 'preserved');
      const script = join(root, 'installer.sh');
      writeFileSync(script, template.replace('TTY=/dev/tty', 'TTY=/dev/null').replaceAll('>"$TTY"', '>/dev/null').replaceAll('<"$TTY"', '<&0'));
      const input = `${target}\n\n\n\n${scenario === 'smtp' ? 'y\nNibleaf <nibleaf@example.test>\nsmtp\nsmtp://localhost:25\n' : `n\n${scenario === 'fresh' ? 'y' : 'n'}\n`}`;
      const result = spawnSync(process.env.TEST_SHELL || 'sh', [script], {
        input,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          NIBLEAF_APP_URL: 'http://localhost:4310',
          NIBLEAF_STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9300',
          NIBLEAF_COMPOSE_SHA256: 'f16d05ec6b29248d2c61adb1e9263f78e4f7bace1b955014a2d17872cfe4064d',
        },
      });
      if (['fresh', 'smtp'].includes(scenario)) {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        const env = readFileSync(join(target, '.env'), 'utf8');
        assert.match(env, new RegExp(`EMAIL_DELIVERY_REQUIRED='${scenario === 'smtp'}'`));
        const key = env.match(/INTEGRATION_CREDENTIAL_ENCRYPTION_KEY='([^']+)'/)[1];
        assert.equal(Buffer.from(key, 'base64').length, 32);
        assert.ok(
          result.stdout.includes(scenario === 'smtp' ? 'open /sign-up for the first owner' : 'add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET'),
          result.stdout,
        );
      } else {
        assert.notEqual(result.status, 0);
        const reason = ['architecture', 'daemon-architecture'].includes(scenario)
          ? 'Unsupported architecture'
          : scenario === 'inspection'
            ? 'Could not inspect'
            : scenario === 'decline'
              ? 'Cancelled'
              : 'Existing';
        assert.ok((result.stdout + result.stderr).includes(reason), result.stdout + result.stderr);
        assert.equal(existsSync(join(target, 'docker-compose.yml')), false);
        if (scenario === 'env') assert.equal(readFileSync(join(target, '.env'), 'utf8'), 'preserved');
        else assert.equal(existsSync(join(target, '.env')), false);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
