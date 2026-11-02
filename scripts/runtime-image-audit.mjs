import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const [image, output] = process.argv.slice(2);
assert.ok(image && !image.startsWith('-'), 'Usage: node scripts/runtime-image-audit.mjs <image> [report.json]');

// Runs inside the final image without forwarding any host env or credentials.
const probe = `
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const app = '/app';
const artifacts = [
  'apps/server/src/index.ts', 'apps/worker/src/index.ts',
  'apps/server/tsconfig.json', 'apps/worker/tsconfig.json',
  'packages/database/prisma.config.ts', 'packages/database/prisma/schema.prisma',
  'packages/database/prisma/migrations/migration_lock.toml',
  'packages/database/src/generated/client.ts',
  'packages/i18n/src/paraglide/messages/_index.js',
  'packages/search/dist/index.mjs', 'apps/server/dist/rpc.mjs',
  'packages/clickhouse/scripts/migrate.ts',
  'packages/email/src/templates/transactional.tsx',
  'scripts/graceful-web-service.mjs',
  'apps/app/.output/server/index.mjs', 'apps/admin/.output/server/index.mjs',
];
for (const file of artifacts) {
  if (!fs.statSync(path.join(app, file)).isFile()) throw new Error('Missing runtime artifact: ' + file);
}
for (const directory of ['apps/app/.output/public', 'apps/admin/.output/public']) {
  if (!fs.readdirSync(path.join(app, directory)).length) throw new Error('Missing public assets: ' + directory);
}
const required = {};
for (const workspace of ['.', 'apps/server', 'apps/worker', 'packages/clickhouse', 'packages/database']) {
  const requireFrom = createRequire(path.join(app, workspace, 'package.json'));
  for (const name of ['tsx', '@nibleaf/tsconfig/hono.json']) {
    required[workspace + ':' + name] = requireFrom.resolve(name);
  }
}
const database = createRequire(path.join(app, 'packages/database/package.json'));
required.prisma = database.resolve('prisma/build/index.js');
required.prismaClient = database.resolve('@prisma/client');
const visited = new Set();
const packages = new Map();
const visit = (directory) => {
  if (!fs.existsSync(directory)) return;
  const actual = fs.realpathSync(directory);
  if (visited.has(actual)) return;
  visited.add(actual);
  const manifest = path.join(actual, 'package.json');
  if (fs.existsSync(manifest)) {
    const value = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    if (value.name) packages.set(actual, { name: value.name, version: value.version, path: path.relative(app, actual) });
    visit(path.join(actual, 'node_modules'));
    return;
  }
  for (const entry of fs.readdirSync(actual, { withFileTypes: true })) {
    if (entry.name === '.bin') continue;
    if (entry.isDirectory() || entry.isSymbolicLink()) visit(path.join(actual, entry.name));
  }
};
visit(path.join(app, 'node_modules'));
for (const service of ['app', 'admin']) visit(path.join(app, 'apps', service, '.output/server/node_modules'));
const inventory = [...packages.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
const forbidden = inventory.filter(({ name }) => name === 'ultracite' || name === 'braces' || name.startsWith('@typescript/typescript-'));
if (forbidden.length) throw new Error('Development-only graph remains installed: ' + JSON.stringify(forbidden));
if (!inventory.some(({ name }) => name === '@modelcontextprotocol/server')) throw new Error('Missing MCP runtime');
console.log(JSON.stringify({ revision: process.env.NIBLEAF_REVISION, artifacts, required, packageCount: inventory.length, forbidden, inventory }));
`;
const result = spawnSync('docker', ['run', '--rm', '--entrypoint', 'node', image, '-e', probe], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || result.stdout);
const report = { image, ...JSON.parse(result.stdout.trim()) };
if (output) {
  const target = resolve(output);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
  JSON.stringify({
    image,
    revision: report.revision,
    artifacts: report.artifacts.length,
    packages: report.packageCount,
    forbidden: report.forbidden,
    report: output,
  }),
);
