import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoots = ['apps', 'packages'];
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
const ignoredDirectories = new Set(['.output', '.turbo', 'build', 'dist', 'node_modules']);
const nativeSelectPatterns = [/<select\b/u, /<option\b/u, /\b(?:React\.)?createElement\(\s*['"]select['"]/u, /\b(?:as|component)=['"]select['"]/u];

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        files.push(...(await collectSourceFiles(entryPath)));
      }
      continue;
    }

    if (sourceExtensions.has(path.extname(entry.name)) && !/\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

test('application source uses the shared shadcn Select instead of native selects', async () => {
  const sourceFiles = (await Promise.all(sourceRoots.map((root) => collectSourceFiles(path.join(repositoryRoot, root))))).flat();
  const violations = [];

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8');
    if (nativeSelectPatterns.some((pattern) => pattern.test(source))) {
      violations.push(path.relative(repositoryRoot, sourceFile));
    }
  }

  assert.deepEqual(violations, [], `Replace native selects with @nibleaf/design-system/components/ui/select in:\n${violations.join('\n')}`);
});
