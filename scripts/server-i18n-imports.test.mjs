import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The `@nibleaf/i18n/messages` index re-exports every Paraglide message
// (thousands of modules). Server-side code imports single messages through
// `@nibleaf/i18n/messages/<id>` so that loading one action doesn't load the
// whole catalog. In #442, the index import made route guards so slow to load
// that a CI test timed out.
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const serverRoots = ['apps/server/src', 'apps/worker/src'];
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx']);
const ignoredDirectories = new Set(['.output', '.turbo', 'build', 'dist', 'node_modules']);
// `from '…'` (import or re-export), a bare side-effect `import '…'`, a dynamic
// `import('…')` and `require('…')` of the index all load the whole catalog.
const indexImport =
  /\bfrom\s*['"]@nibleaf\/i18n\/messages['"]|\bimport\s*['"]@nibleaf\/i18n\/messages['"]|\bimport\s*\(\s*['"]@nibleaf\/i18n\/messages['"]\s*\)|\brequire\s*\(\s*['"]@nibleaf\/i18n\/messages['"]\s*\)/u;

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...(await collectSourceFiles(entryPath)));
    } else if (sourceExtensions.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }
  return files;
}

test('server and worker code import single messages, never the whole message catalog', async () => {
  const files = (await Promise.all(serverRoots.map((root) => collectSourceFiles(path.join(repositoryRoot, root))))).flat();
  assert.ok(files.length > 0, 'no server source files found');
  const violations = [];
  for (const file of files) {
    if (indexImport.test(await readFile(file, 'utf8'))) violations.push(path.relative(repositoryRoot, file).split(path.sep).join('/'));
  }
  assert.deepEqual(
    violations,
    [],
    `Import messages one by one, e.g. import { editor_untitled } from '@nibleaf/i18n/messages/editor_untitled', instead of the '@nibleaf/i18n/messages' index in:\n${violations.join('\n')}`,
  );
});

test('the guard catches every form of importing the message index, and allows single messages', () => {
  const caught = [
    "import { editor_untitled } from '@nibleaf/i18n/messages';",
    'import * as m from "@nibleaf/i18n/messages";',
    "import '@nibleaf/i18n/messages';",
    "export { editor_untitled } from '@nibleaf/i18n/messages';",
    "const m = await import('@nibleaf/i18n/messages');",
    "const m = require('@nibleaf/i18n/messages');",
  ];
  const allowed = [
    "import { editor_untitled } from '@nibleaf/i18n/messages/editor_untitled';",
    "import '@nibleaf/i18n/messages/editor_untitled';",
    "const m = await import('@nibleaf/i18n/messages/editor_untitled');",
    "import { resolveLocale } from '@nibleaf/i18n/locales';",
  ];
  assert.deepEqual(
    caught.filter((source) => !indexImport.test(source)),
    [],
  );
  assert.deepEqual(
    allowed.filter((source) => indexImport.test(source)),
    [],
  );
});
