import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const modulesRoot = path.join(repositoryRoot, 'node_modules');
const vitestCli = path.join(modulesRoot, 'vitest', 'vitest.mjs');

for (const app of ['app', 'admin', 'server', 'worker']) {
  test(`${app} unit tests ignore local env files`, () => {
    // Keep the fixture under node_modules so its test can resolve Vitest.
    const fixtureRoot = mkdtempSync(path.join(modulesRoot, '.nibleaf-test-env-'));
    try {
      mkdirSync(path.join(fixtureRoot, 'src'));
      for (const file of ['.env', '.env.local', '.env.test', '.env.test.local']) {
        writeFileSync(path.join(fixtureRoot, file), 'VITE_NIBLEAF_TEST_ENV_FILE=local-file\n');
      }
      writeFileSync(
        path.join(fixtureRoot, 'src', 'env.test.ts'),
        `import { expect, it } from 'vitest';
it('ignores env files in import.meta.env and process.env', () => {
  expect(import.meta.env.VITE_NIBLEAF_TEST_ENV_FILE).toBeUndefined();
  expect(process.env.VITE_NIBLEAF_TEST_ENV_FILE).toBeUndefined();
});
`,
      );
      const childEnv = { ...process.env };
      delete childEnv.VITE_NIBLEAF_TEST_ENV_FILE;
      const result = spawnSync(
        process.execPath,
        [vitestCli, 'run', '--config', path.join(repositoryRoot, 'apps', app, 'vitest.config.ts'), '--root', fixtureRoot],
        { cwd: repositoryRoot, env: childEnv, encoding: 'utf8', timeout: 30_000 },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    } finally {
      assert.equal(path.dirname(fixtureRoot), modulesRoot);
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
}
