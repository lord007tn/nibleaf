import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zipSync } from 'fflate';

const revision = process.argv[2];
if (!revision || !/^[a-f0-9]{40}$/.test(revision)) {
  throw new Error('Usage: pnpm --filter @nibleaf/server fixtures:record-docs <full commit SHA>');
}
const root = resolve(import.meta.dirname, '../../../../../..');
const git = (args) => execFileSync('git', args, { cwd: root, maxBuffer: 4 * 1024 * 1024 });
const paths = git(['ls-tree', '-rz', '--name-only', revision, '--', 'docs/']).toString('utf8').split('\0').filter(Boolean);
const files = {
  'recording.json': Buffer.from(JSON.stringify({ repository: 'lord007tn/nibleaf', revision, paths }, null, 2)),
  ...Object.fromEntries(paths.filter((path) => /\.(?:mdx?|json)$/i.test(path)).map((path) => [path, git(['show', `${revision}:${path}`])])),
};
writeFileSync(new URL('./nibleaf-docs.source.zip', import.meta.url), zipSync(files, { level: 9, mtime: new Date(1980, 0, 1) }));
process.stdout.write(`Recorded ${paths.length} documentation paths at ${revision}.\n`);
