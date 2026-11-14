// Reproduce the main floors for both export guards. From the repository root:
// node --import tsx packages/shared/src/__fixtures__/markdown-export.guard.generate.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXPORT_BASELINE_REVISION, recordExportBaseline } from '../testing/export-guard.ts';
import { EXPORT_GUARD_SEED, exportFollowingBlockCases, htmlExportBoundaryCases, seededExportCases } from '../testing/export-guard-cases.ts';

const here = dirname(fileURLToPath(import.meta.url));
const shared = resolve(here, '../..');
const root = resolve(shared, '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const revision = git('rev-parse', `${EXPORT_BASELINE_REVISION}^{commit}`).trim();
const baseline = mkdtempSync(join(shared, '.export-guard-baseline-'));
// This freshly created, absolute direct child is the only directory removed.
if (dirname(baseline) !== shared) throw new Error('Unexpected baseline directory');
try {
  for (const name of ['public-markdown-content.ts', 'mdx-tokens.ts', 'markdown-code.ts', 'markup-scan.ts', 'uuid.ts'])
    writeFileSync(join(baseline, name), git('show', `${revision}:packages/shared/src/${name}`));
  const { normalizePublicMarkdownContent, portablePublicMdxMarkdown } = await import(
    pathToFileURL(join(baseline, 'public-markdown-content.ts')).href
  );
  const projectors = [normalizePublicMarkdownContent, portablePublicMdxMarkdown];
  const following = exportFollowingBlockCases().map((entry) => ({ ...entry, outputs: projectors.map((project) => project(entry.source)) }));
  const followingTarget = join(here, 'markdown-export.following.main.json');
  writeFileSync(followingTarget, `${JSON.stringify({ revision, cases: following })}\n`);
  execFileSync(process.execPath, [join(root, 'node_modules/@biomejs/biome/bin/biome'), 'format', '--write', followingTarget], { cwd: root });
  for (const { name, cases, seed } of [
    { name: '2640', cases: htmlExportBoundaryCases() },
    { name: '4096', cases: seededExportCases(), seed: EXPORT_GUARD_SEED },
  ]) {
    const fixture = { revision, ...(seed === undefined ? {} : { seed }), ...recordExportBaseline(cases, projectors) };
    const target = join(here, `markdown-export.guard.main-${revision.slice(0, 8)}.${name}.json`);
    writeFileSync(target, `${JSON.stringify(fixture)}\n`);
    execFileSync(process.execPath, [join(root, 'node_modules/@biomejs/biome/bin/biome'), 'format', '--write', '--files-max-size=8388608', target], {
      cwd: root,
    });
    console.info(`Recorded ${cases.length} export shapes from main ${revision}.`);
  }
} finally {
  rmSync(baseline, { recursive: true, force: true });
}
