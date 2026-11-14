// Record main's serializer output for the differential corpus (#612). From the repository root:
// node apps/app/src/components/editor/__fixtures__/serializer-differential.generate.mjs
//
// Main's editor directory is checked out next to the current one (inside apps/app/src,
// so its `@/` imports and packages resolve as the app's do), and
// serializer-differential.test.ts is run in record mode against it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE_REVISION = 'd93468d698bf4d3e2d7e484aed4b4ec133cbea65';
const EDITOR = 'apps/app/src/components/editor';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../../..');
const app = join(root, 'apps/app');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
const revision = git('rev-parse', `${BASELINE_REVISION}^{commit}`).trim();
const components = join(root, 'apps/app/src/components');
const baseline = mkdtempSync(join(components, '.serializer-baseline-'));
// This freshly created, absolute direct child is the only directory removed.
if (dirname(baseline) !== components) throw new Error('Unexpected baseline directory');
try {
  for (const file of git('ls-tree', '-r', '--name-only', revision, `${EDITOR}/`).split('\n').filter(Boolean)) {
    const target = join(baseline, relative(EDITOR, file));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, maxBuffer: 1 << 26 }));
  }
  const out = join(here, `serializer-differential.main-${revision.slice(0, 8)}.json`);
  execFileSync(
    process.execPath,
    [join(root, 'node_modules/vitest/vitest.mjs'), 'run', '--maxWorkers=1', 'src/components/editor/serializer-differential.test.ts'],
    {
      cwd: app,
      stdio: 'inherit',
      env: { ...process.env, SERIALIZER_BASELINE_DIR: baseline, SERIALIZER_BASELINE_REVISION: revision, SERIALIZER_BASELINE_OUT: out },
    },
  );
  execFileSync(process.execPath, [join(root, 'node_modules/@biomejs/biome/bin/biome'), 'format', '--write', out], { cwd: root });
  console.info(`Recorded main ${revision} serializer output to ${relative(root, out)}.`);
} finally {
  rmSync(baseline, { recursive: true, force: true });
}
