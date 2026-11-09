import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkContainerCommands } from './check-container-commands.mjs';

const fixture = async (source, check, changelog = '## Unreleased\n\n## v0.2.1\n') => {
  const root = await mkdtemp(join(tmpdir(), 'nibleaf-container-docs-'));
  try {
    await mkdir(join(root, 'docs'));
    await mkdir(join(root, 'operations'));
    await writeFile(join(root, 'README.md'), source);
    await writeFile(join(root, 'CHANGELOG.md'), changelog);
    await writeFile(join(root, 'docker-entrypoint.sh'), 'case "$cmd" in\n  search-reindex-all)\n  search-alias-switch)\nesac\n');
    await check(checkContainerCommands(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

test('evergreen repository container examples use shipped executables and entrypoint commands', () => {
  const result = checkContainerCommands();
  assert.deepEqual(result.errors, []);
  assert.ok(result.checked > 20);
  assert.ok(result.runtimeCommands.includes('/app/docker-entrypoint.sh'));
});

test('continued exec options and quoted environment values cannot hide pnpm', async () => {
  await fixture(
    'docker compose -f prod.yml exec -T \\\n -e "QDRANT_ALIAS=two words" \\\n server pnpm --filter @nibleaf/qdrant alias:switch',
    (result) => {
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0], /server pnpm: executable is not shipped/);
    },
  );
});

test('exec validates subcommands while run uses the image entrypoint', async () => {
  await fixture(
    'docker compose exec -T server /app/docker-entrypoint.sh search-reindex-all\ndocker compose run --rm --no-deps -T worker search-alias-switch\ndocker compose exec server /app/docker-entrypoint.sh missing-task',
    (result) => {
      assert.equal(result.checked, 3);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0], /unknown entrypoint subcommand missing-task/);
    },
  );
});

test('rejects package-manager shell wrappers and undeclared backing commands', async () => {
  await fixture("docker compose exec server sh -c 'pnpm run migrate'\ndocker compose exec postgres pnpm migrate", (result) => {
    assert.equal(result.errors.length, 2);
    assert.match(result.errors[0], /shell snippets/);
    assert.match(result.errors[1], /backing-image executable/);
  });
});

test('checks Unreleased without rewriting instructions for retained release images', async () => {
  await fixture('', (result) => assert.deepEqual(result.errors, []), '## Unreleased\n\n## v0.2.1\ndocker compose exec server pnpm old-task\n');
  await fixture('', (result) => assert.equal(result.errors.length, 1), '## Unreleased\ndocker compose exec server pnpm new-task\n\n## v0.2.1\n');
});

test('only the named published release pages are exempt, including their Arabic translation', async () => {
  await fixture('', async (_result, root) => {
    for (const directory of ['docs/releases', 'docs/ar/releases', 'docs/ar/self-hosting']) await mkdir(join(root, directory), { recursive: true });
    for (const file of ['docs/releases/v0-2-1.mdx', 'docs/ar/releases/v0-2-1.mdx'])
      await writeFile(join(root, file), 'docker compose exec server pnpm old-task');
    await writeFile(join(root, 'docs/ar/self-hosting/search-ai.mdx'), 'docker compose exec server pnpm new-task');
    const result = checkContainerCommands(root);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /docs\/ar\/self-hosting\/search-ai/);
  });
});
