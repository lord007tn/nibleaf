import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = process.env.NIBLEAF_SIGNAL_TEST_MODULES ?? join(root, 'node_modules');

function stopFixture(pid) {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

for (const service of ['server', 'worker']) {
  test(`${service} entrypoint delivers SIGTERM to its TypeScript process`, { skip: process.platform === 'win32', timeout: 15_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'nibleaf-service-signals-'));
    const serviceDirectory = join(directory, 'apps', service);
    await mkdir(join(serviceDirectory, 'src'), { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, packageManager: 'pnpm@10.30.3' }));
    await writeFile(join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
    await writeFile(join(serviceDirectory, 'package.json'), JSON.stringify({ name: `@nibleaf/${service}`, type: 'module' }));
    await symlink(modules, join(directory, 'node_modules'), 'dir');
    await writeFile(
      join(serviceDirectory, 'src', 'index.ts'),
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
