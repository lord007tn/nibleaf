// Record main's export of #591's reader-fence family, and main's fence
// protection on the reader differential's generated sources. From the
// repository root:
// node --import tsx packages/shared/src/__fixtures__/mdx-tokens.reader-fences.generate.mjs <main revision>
// The revision's own packages/shared/src is projected, so this file and the
// generators it imports may be newer than it.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readerFenceDifferentialFamilies } from '../testing/reader-fence-differential.ts';
import { protectedLines, readerFenceCommentCases, readerFenceExportCases, readerFenceLiteralCases } from '../testing/reader-fence-export-cases.ts';

const here = dirname(fileURLToPath(import.meta.url));
const shared = resolve(here, '../..');
const root = resolve(shared, '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const revision = git('rev-parse', `${process.argv[2] ?? 'origin/main'}^{commit}`).trim();
const copy = mkdtempSync(join(shared, '.reader-fence-baseline-'));
// This freshly created, absolute direct child is the only directory removed.
if (dirname(copy) !== shared) throw new Error('Unexpected baseline directory');
try {
  const archive = join(copy, 'src.tar');
  git('archive', '--format=tar', `--output=${archive}`, `${revision}:packages/shared/src`);
  execFileSync('tar', ['-xf', 'src.tar'], { cwd: copy });
  const load = (name) => import(pathToFileURL(join(copy, name)).href);
  const { normalizePublicMarkdownContent, portablePublicMdxMarkdown } = await load('public-markdown-content.ts');
  const { tokenizeMdx } = await load('mdx-tokens.ts');
  const components = new Set(['note', 'warning', 'tip', 'info', 'check', 'danger', 'callout', 'steps', 'badge']);
  const protection = (source) =>
    protectedLines(tokenizeMdx(source, components), source.split('\n').length)
      .map((line) => (line ? '1' : '0'))
      .join('');
  const record = ({ source }) => ({
    outputs: [normalizePublicMarkdownContent(source), portablePublicMdxMarkdown(source)],
    protection: protection(source),
  });
  const cases = readerFenceExportCases().map(record);
  // MDX comments and other lines the reader strips or doesn't render as prose (#917 review).
  const comments = readerFenceCommentCases().map(record);
  // Regions the reader renders literally: math blocks and raw-text HTML (#917 re-check).
  const literals = readerFenceLiteralCases().map(record);
  const families = Object.fromEntries(
    readerFenceDifferentialFamilies().map(({ name, sources }) => {
      const lines = sources.map(protection);
      const hash = createHash('sha256').update(lines.join('\n')).digest('hex');
      // The small repro family is kept line by line, so its exceptions can be named.
      return [name, { count: sources.length, protection: hash, ...(sources.length <= 64 ? { lines } : {}) }];
    }),
  );
  const target = join(here, 'mdx-tokens.reader-fences.main.json');
  writeFileSync(target, `${JSON.stringify({ revision, cases, families, comments, literals })}\n`);
  execFileSync(process.execPath, [join(root, 'node_modules/@biomejs/biome/bin/biome'), 'format', '--write', target], { cwd: root });
  console.info(
    `Recorded ${cases.length} export shapes, ${comments.length} comment shapes, ${literals.length} literal shapes and ${Object.keys(families).length} protection families from main ${revision}.`,
  );
} finally {
  rmSync(copy, { recursive: true, force: true });
}
