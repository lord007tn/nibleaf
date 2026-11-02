import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Manual only. Uses synthetic canaries, never reads browser state or host env.
const root = fileURLToPath(new URL('../', import.meta.url));
const ignore = (await readFile(join(root, '.dockerignore'), 'utf8')).split(/\r?\n/).map((line) => line.trim());
for (const pattern of [
  '**/.env',
  '**/.env.*',
  '!**/.env.example',
  '!**/.env.production.example',
  '/output/',
  '/.playwright/',
  '/.playwright-cli/',
  '/.playwright-mcp/',
  '**/playwright/.auth/',
  '**/playwright/.cache/',
  '/blob-report/',
  '/.docker-data/',
]) {
  assert.ok(ignore.includes(pattern), `Refusing to send a context without ${pattern}`);
}

const id = randomUUID();
const filename = `runtime-context-${id}.json`;
const publicExample = `apps/runtime-context-${id}/.env.example`;
const paths = [
  `output/playwright/.auth/${filename}`,
  `.playwright/${filename}`,
  `.playwright-cli/${filename}`,
  `.playwright-mcp/${filename}`,
  `apps/app/playwright/.auth/${filename}`,
  `apps/app/playwright/.cache/${filename}`,
  `blob-report/${filename}`,
  `.docker-data/${filename}`,
  `.env.runtime-context-${id}`,
  `apps/app/.env.runtime-context-${id}`,
  'packages/email/.env',
];
const created = [];
const tag = `nibleaf-runtime-context:${id}`;
try {
  for (const path of paths) {
    const absolute = join(root, path);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, `synthetic-context-canary:${id}\n`, { flag: 'wx' });
    created.push(absolute);
  }
  const examplePath = join(root, publicExample);
  await mkdir(dirname(examplePath), { recursive: true });
  await writeFile(examplePath, 'SYNTHETIC_PUBLIC_EXAMPLE=example\n', { flag: 'wx' });
  created.push(examplePath);
  const probe = [
    "const fs = require('node:fs');",
    "if (!fs.existsSync('/context/package.json')) throw new Error('Application source was not copied');",
    `for (const path of ${JSON.stringify(['.env.example', '.env.production.example', publicExample])}) {`,
    "if (!fs.existsSync('/context/' + path)) throw new Error('Public env example was excluded: ' + path);",
    '}',
    `for (const path of ${JSON.stringify(paths)}) {`,
    "if (fs.existsSync('/context/' + path)) throw new Error('Excluded canary entered Docker context: ' + path);",
    '}',
    "console.log('Docker context excludes all synthetic QA, auth, volume, and env canaries.');",
  ].join('\n');
  const dockerfile = ['FROM node:22-alpine AS smoke', 'COPY . /context', `RUN ${JSON.stringify(['node', '-e', probe])}`, ''].join('\n');
  const result = spawnSync('docker', ['build', '--progress=plain', '--file', '-', '--tag', tag, root], {
    input: dockerfile,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, 'Docker context smoke failed');
} finally {
  // Only unlink the uniquely named files this invocation created. Never remove
  // a QA directory or volume that may contain somebody else's data.
  await Promise.all(created.map((path) => unlink(path)));
  spawnSync('docker', ['image', 'rm', tag], { stdio: 'ignore' });
}
