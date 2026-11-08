import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// `pnpm test` runs every package's Vitest in parallel. Vitest's module cache
// defaults to one directory at the workspace root, so one package's cleanup
// could race another's writes (ENOTEMPTY on Windows, #330). Each package keeps
// its own cache under its own node_modules instead.
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const modulesRoot = path.join(repositoryRoot, 'node_modules');
const vitestCli = path.join(modulesRoot, 'vitest', 'vitest.mjs');
const CACHE_FLAG = '--fsModuleCachePath node_modules/.vitest-cache';

const workspacePackages = ['apps', 'packages'].flatMap((group) =>
  readdirSync(path.join(repositoryRoot, group), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(path.join(repositoryRoot, group, entry.name, 'package.json')))
    .map((entry) => `${group}/${entry.name}`),
);

test('every package that runs Vitest keeps its module cache in its own node_modules', () => {
  const vitestPackages = workspacePackages.filter((dir) => {
    const { scripts = {} } = JSON.parse(readFileSync(path.join(repositoryRoot, dir, 'package.json'), 'utf8'));
    return /\bvitest\b/.test(scripts.test ?? '');
  });
  assert.ok(vitestPackages.length > 0);
  const shared = vitestPackages.filter((dir) => {
    const { scripts } = JSON.parse(readFileSync(path.join(repositoryRoot, dir, 'package.json'), 'utf8'));
    return !scripts.test.includes(CACHE_FLAG);
  });
  assert.deepEqual(shared, [], `These packages share the root Vitest cache: ${shared.join(', ')}`);
});

test('the cache flag resolves against the package root, not the workspace root', () => {
  // Keep the fixture under node_modules so its test can resolve Vitest.
  const fixtureRoot = mkdtempSync(path.join(modulesRoot, '.nibleaf-test-cache-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'src'));
    writeFileSync(path.join(fixtureRoot, 'src', 'cache.test.ts'), "import { expect, it } from 'vitest';\nit('runs', () => expect(1).toBe(1));\n");
    const result = spawnSync(process.execPath, [vitestCli, 'run', ...CACHE_FLAG.split(' '), '--root', fixtureRoot], {
      cwd: fixtureRoot,
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.ok(existsSync(path.join(fixtureRoot, 'node_modules', '.vitest-cache')), 'the fixture got its own module cache');
  } finally {
    assert.equal(path.dirname(fixtureRoot), modulesRoot);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
