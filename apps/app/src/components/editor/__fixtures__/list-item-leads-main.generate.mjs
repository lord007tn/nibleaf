// Record main's nodes, saves and checks for the list item lead differential and matrix (#604, #865).
// From the repository root:
// node apps/app/src/components/editor/__fixtures__/list-item-leads-main.generate.mjs
//
// Main's editor directory is checked out next to the current one (inside apps/app/src,
// so its `@/` imports and packages resolve as the app's do), and
// list-item-leads-main.test.ts, list-item-lead-matrix.test.ts and list-item-lead-emptied.test.ts are
// run in record mode against it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE_REVISION = '3d23d2923862d3f0b8c4131004dcea1a5ca88f96';
const EDITOR = 'apps/app/src/components/editor';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../../../..');
const app = join(root, 'apps/app');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
const revision = git('rev-parse', `${BASELINE_REVISION}^{commit}`).trim();
const components = join(root, 'apps/app/src/components');
const baseline = mkdtempSync(join(components, '.list-item-leads-baseline-'));
// This freshly created, absolute direct child is the only directory removed.
if (dirname(baseline) !== components) throw new Error('Unexpected baseline directory');
try {
  for (const file of git('ls-tree', '-r', '--name-only', revision, `${EDITOR}/`).split('\n').filter(Boolean)) {
    const target = join(baseline, relative(EDITOR, file));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, execFileSync('git', ['show', `${revision}:${file}`], { cwd: root, maxBuffer: 1 << 26 }));
  }
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/vitest/vitest.mjs'),
      'run',
      '--maxWorkers=1',
      'src/components/editor/list-item-leads-main.test.ts',
      'src/components/editor/list-item-lead-matrix.test.ts',
      'src/components/editor/list-item-lead-emptied.test.ts',
    ],
    {
      cwd: app,
      stdio: 'inherit',
      env: { ...process.env, LIST_ITEM_LEADS_BASELINE_DIR: baseline, LIST_ITEM_LEADS_BASELINE_REVISION: revision },
    },
  );
  console.info(`Recorded main ${revision} list item lead records.`);
} finally {
  rmSync(baseline, { recursive: true, force: true });
}
