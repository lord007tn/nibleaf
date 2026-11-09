import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = process.env.NIBLEAF_SIGNAL_TEST_MODULES ?? join(root, 'node_modules');

test('migration modes run without a package manager and stop before seeding on failure', { skip: process.platform === 'win32' }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nibleaf-migration-entrypoint-'));
  const receipt = join(directory, 'commands.log');
  try {
    for (const path of ['bin', 'packages/database', 'packages/clickhouse', 'packages/qdrant', 'apps/server'])
      await mkdir(join(directory, path), { recursive: true });
    await writeFile(
      join(directory, 'bin/node'),
      `#!/bin/sh
printf "%s|%s|%s\\n" "$PWD" "$*" "\${ALLOW_SEED:-}" >> "$RECEIPT"
exit "\${FIXTURE_EXIT:-0}"
`,
      { mode: 0o755 },
    );
    const run = (mode, extra = {}) =>
      spawnSync('/bin/sh', [join(root, 'docker-entrypoint.sh'), mode], {
        cwd: directory,
        env: {
          ...process.env,
          PATH: `${join(directory, 'bin')}${delimiter}${process.env.PATH}`,
          NODE_ENV: 'production',
          BETTER_AUTH_SECRET: 'synthetic-migration-secret-2026-11-08',
          NIBLEAF_RUN_SEED: 'false',
          RECEIPT: receipt,
          ...extra,
        },
        encoding: 'utf8',
        timeout: 5000,
      });
    assert.equal(run('migrate').status, 0);
    assert.equal(await readFile(receipt, 'utf8'), `${directory}/packages/database|../../node_modules/prisma/build/index.js migrate deploy|\n`);
    await writeFile(receipt, '');
    assert.equal(run('migrate', { NIBLEAF_RUN_SEED: 'true' }).status, 0);
    assert.equal(
      await readFile(receipt, 'utf8'),
      `${directory}/packages/database|../../node_modules/prisma/build/index.js migrate deploy|\n${directory}/apps/server|--import tsx src/database/seed/index.ts|1\n`,
    );
    await writeFile(receipt, '');
    assert.equal(run('migrate', { NIBLEAF_RUN_SEED: 'true', FIXTURE_EXIT: '42' }).status, 42);
    assert.equal((await readFile(receipt, 'utf8')).trim().split('\n').length, 1);
    await writeFile(receipt, '');
    assert.equal(run('clickhouse-migrate').status, 0);
    assert.equal(await readFile(receipt, 'utf8'), `${directory}/packages/clickhouse|--import tsx scripts/migrate.ts|\n`);
    await writeFile(receipt, '');
    assert.equal(run('search-reindex-all').status, 0);
    assert.equal(await readFile(receipt, 'utf8'), `${directory}/apps/server|--import tsx src/scripts/reindex-search.ts|\n`);
    assert.equal(run('search-reindex-all', { FIXTURE_EXIT: '42' }).status, 42);
    await writeFile(receipt, '');
    assert.equal(run('search-alias-switch').status, 0);
    assert.equal(await readFile(receipt, 'utf8'), `${directory}/packages/qdrant|--import tsx scripts/switch-alias.ts|\n`);
    assert.equal(run('search-alias-switch', { FIXTURE_EXIT: '42' }).status, 42);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('web wrapper marks draining before forwarding SIGTERM', { skip: process.platform === 'win32', timeout: 8000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nibleaf-web-signal-'));
  const entrypoint = join(directory, 'web.mjs');
  const drainFile = join(directory, 'draining');
  const receipt = join(directory, 'shutdown.json');
  await writeFile(
    entrypoint,
    `import { existsSync, writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {
  writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ draining: existsSync(process.env.NIBLEAF_DRAIN_FILE), at: Date.now() }));
  process.exit(0);
});
console.log('FIXTURE_READY');
setInterval(() => {}, 1000);
`,
  );
  const child = spawn(process.execPath, [join(root, 'scripts/graceful-web-service.mjs'), entrypoint], {
    detached: true,
    env: { ...process.env, NIBLEAF_DRAIN_FILE: drainFile, NIBLEAF_DRAIN_DELAY_MS: '1000', NIBLEAF_WEB_FORCE_EXIT_MS: '1000' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  try {
    await Promise.race([
      new Promise((resolve) =>
        child.stdout.on('data', (data) => {
          if (data.toString().includes('FIXTURE_READY')) resolve();
        }),
      ),
      exited.then(() => {
        throw new Error('Web fixture exited before readiness');
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Web fixture readiness timed out')), 3000).unref()),
    ]);
    const signalledAt = Date.now();
    child.kill('SIGTERM');
    const [code, signal] = await exited;
    assert.equal(code, 0);
    assert.equal(signal, null);
    const shutdown = JSON.parse(await readFile(receipt, 'utf8'));
    assert.equal(shutdown.draining, true);
    assert.ok(shutdown.at - signalledAt >= 950, 'the web child must receive its drain window before SIGTERM');
    assert.equal(await readFile(drainFile, 'utf8'), 'SIGTERM\n');
  } finally {
    stopFixture(child.pid);
    await rm(directory, { recursive: true, force: true });
  }
});

for (const failure of ['exit-code', 'deadline']) {
  test(`web shutdown reports ${failure} failure`, { skip: process.platform === 'win32', timeout: 8000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nibleaf-web-failure-'));
    const entrypoint = join(directory, 'web.mjs');
    await writeFile(
      entrypoint,
      `process.on('SIGTERM', () => { ${failure === 'exit-code' ? 'process.exit(7);' : ''} });
console.log('FIXTURE_READY');
setInterval(() => {}, 1000);
`,
    );
    const child = spawn(process.execPath, [join(root, 'scripts/graceful-web-service.mjs'), entrypoint], {
      detached: true,
      env: {
        ...process.env,
        NIBLEAF_DRAIN_FILE: join(directory, 'draining'),
        NIBLEAF_DRAIN_DELAY_MS: '1000',
        NIBLEAF_WEB_FORCE_EXIT_MS: '1000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = once(child, 'exit');
    let output = '';
    child.stderr.on('data', (data) => {
      output += data;
    });
    try {
      await Promise.race([
        new Promise((resolve) =>
          child.stdout.on('data', (data) => {
            if (data.toString().includes('FIXTURE_READY')) resolve();
          }),
        ),
        exited.then(() => {
          throw new Error('Web fixture exited before readiness');
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Web fixture readiness timed out')), 3000).unref()),
      ]);
      child.kill('SIGTERM');
      const [code, signal] = await exited;
      assert.equal(code, failure === 'exit-code' ? 7 : 1);
      assert.equal(signal, null);
      if (failure === 'deadline') assert.match(output, /shutdown deadline; sending SIGKILL/);
    } finally {
      stopFixture(child.pid);
      await rm(directory, { recursive: true, force: true });
    }
  });
}

function stopFixture(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

for (const { command: service, workspace, file } of [
  { command: 'server', workspace: 'apps/server', file: 'src/index.ts' },
  { command: 'worker', workspace: 'apps/worker', file: 'src/index.ts' },
  { command: 'search-reindex-all', workspace: 'apps/server', file: 'src/scripts/reindex-search.ts' },
  { command: 'search-alias-switch', workspace: 'packages/qdrant', file: 'scripts/switch-alias.ts' },
]) {
  test(`${service} entrypoint delivers SIGTERM to its TypeScript process`, { skip: process.platform === 'win32', timeout: 15_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nibleaf-service-signals-'));
    const serviceDirectory = join(directory, workspace);
    await mkdir(dirname(join(serviceDirectory, file)), { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@10.30.3' }));
    await writeFile(join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    await writeFile(join(serviceDirectory, 'package.json'), JSON.stringify({ name: `@nibleaf/${service}`, type: 'module' }));
    await symlink(modules, join(directory, 'node_modules'), 'dir');
    await writeFile(
      join(serviceDirectory, file),
      `import { writeFileSync } from 'node:fs';
const service: string = ${JSON.stringify(service)};
process.on('SIGTERM', () => {
  writeFileSync('shutdown.json', JSON.stringify({ service, signal: 'SIGTERM', cwd: process.cwd() }));
  process.exit(0);
});
console.log('SERVICE_READY');
setInterval(() => {}, 1000);
`,
    );
    const child = spawn('/bin/sh', [join(root, 'docker-entrypoint.sh'), service], {
      cwd: directory,
      detached: true,
      env: {
        ...process.env,
        PATH: `${join(modules, '.bin')}${delimiter}${process.env.PATH}`,
        NODE_ENV: 'production',
        BETTER_AUTH_SECRET: 'synthetic-process-signal-test-secret-2026',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    const exited = once(child, 'exit');
    try {
      await Promise.race([
        new Promise((resolve) => {
          child.stdout.on('data', () => {
            if (output.includes('SERVICE_READY')) resolve();
          });
        }),
        exited.then(() => {
          throw new Error(`Entrypoint exited before readiness: ${output}`);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Readiness timed out: ${output}`)), 8000).unref()),
      ]);
      child.kill('SIGTERM');
      const [code, signal] = await exited;
      assert.equal(code, 0, `Expected graceful exit, got ${code}/${signal}: ${output}`);
      assert.equal(signal, null);
      assert.deepEqual(JSON.parse(await readFile(join(serviceDirectory, 'shutdown.json'), 'utf8')), {
        service,
        signal: 'SIGTERM',
        cwd: serviceDirectory,
      });
    } finally {
      // The process group belongs only to this disposable fixture, including any wrapper children.
      stopFixture(child.pid);
      await rm(directory, { recursive: true, force: true });
    }
  });
}
