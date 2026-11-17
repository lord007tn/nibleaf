// Records main's fence lines, extractHeadings and readerSections for every page
// of the repository's Markdown corpus (src/testing/markdown-corpus.ts), as
// hashes, into markdown-code.corpus.main-93408093.json beside this script. The
// corpus test (src/markdown-code.corpus.test.ts) compares the current scanner
// with it without running main's code.
//
// Regenerate after adding, removing or editing a page, from the repository root:
//
//   node --import tsx packages/shared/src/__fixtures__/markdown-code.corpus.generate.mjs
//
// It copies packages/shared/src at main 93408093 (before #587) next to the
// package, so that copy resolves the package's dependencies, loads main's
// modules from it, and removes the copy when done.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REVISION = '93408093';
const here = dirname(fileURLToPath(import.meta.url));
const shared = join(here, '..', '..');
const root = join(shared, '..', '..');
const git = (args, encoding = 'utf8') => execFileSync('git', args, { cwd: root, encoding, maxBuffer: 1 << 28 });
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

const commit = git(['rev-parse', '--verify', `${REVISION}^{commit}`]).trim();
const baseline = join(shared, `.corpus-baseline-${process.pid}`);
try {
  for (const path of git(['ls-tree', '-r', '--name-only', commit, '--', 'packages/shared/src']).split('\n')) {
    if (!/\.(ts|tsx|json)$/.test(path)) continue;
    const target = join(baseline, path.slice('packages/shared/'.length));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, git(['show', `${commit}:${path}`], 'buffer'));
  }
  const load = (file) => import(pathToFileURL(join(baseline, 'src', file)).href);
  const [{ extractHeadings }, { readerSections }, { fencedMarkdownLines }] = await Promise.all([
    load('site.ts'),
    load('reader-headings.ts'),
    load('markdown-code.ts'),
  ]);
  const current = (file) => import(pathToFileURL(join(shared, 'src', 'testing', file)).href);
  const [{ markdownCorpus }, { AFTER_FENCE, FENCE_CONTAINER_REPROS }] = await Promise.all([current('markdown-corpus.ts'), current('fence-cases.ts')]);

  const pages = {};
  for (const [name, source] of markdownCorpus(root).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const lines = source.split('\n');
    pages[name] = {
      source: hash(source),
      lines: hash(fencedMarkdownLines(lines).map(Number).join('')),
      headings: hash(JSON.stringify(extractHeadings(source))),
      sections: hash(JSON.stringify(readerSections(source))),
      // Main left a fence open at the end of the page (an overrun).
      open: Boolean(fencedMarkdownLines([...lines, '']).at(-1)),
    };
  }
  // Main lost the heading after #587's first repro: proof these are main's outputs.
  const repro = `${FENCE_CONTAINER_REPROS[0][1]}${AFTER_FENCE}`;
  const guard = { reproHeadings: extractHeadings(repro).length, reproSections: readerSections(repro).length };
  const fixture = { revision: commit, guard, pages };
  writeFileSync(join(here, 'markdown-code.corpus.main-93408093.json'), `${JSON.stringify(fixture, null, 2)}\n`);
  console.info(`Recorded ${Object.keys(pages).length} pages from ${commit}.`);
} finally {
  rmSync(baseline, { recursive: true, force: true });
}
