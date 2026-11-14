// Record marker preservation from exact main, without keeping another tokenizer.
// Run: node --import tsx packages/shared/src/__fixtures__/html-export.generate.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { activeExportHtml, htmlExportBoundaryCases } from '../testing/html-export-boundary-cases.ts';
import { HTML_EXPORT_SEED, htmlExportCases } from '../testing/html-export-cases.ts';

const here = dirname(fileURLToPath(import.meta.url));
const shared = resolve(here, '../..');
const root = resolve(shared, '../..');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const revision = git('rev-parse', '19522197^{commit}').trim();
const baseline = mkdtempSync(join(shared, '.html-export-baseline-'));
// Only this newly created, direct child of the package is removed below.
if (dirname(baseline) !== shared) throw new Error('Unexpected baseline directory');
try {
  // These five files are the complete relative import graph of the projection.
  for (const name of ['public-markdown-content.ts', 'mdx-tokens.ts', 'markdown-code.ts', 'markup-scan.ts', 'uuid.ts']) {
    writeFileSync(join(baseline, name), git('show', `${revision}:packages/shared/src/${name}`));
  }
  const { normalizePublicMarkdownContent, portablePublicMdxMarkdown } = await import(
    pathToFileURL(join(baseline, 'public-markdown-content.ts')).href
  );
  for (const { name, cases, seed, checkActive } of [
    { name: 'html-export', cases: htmlExportCases(), seed: HTML_EXPORT_SEED, checkActive: false },
    { name: 'html-export-boundaries', cases: htmlExportBoundaryCases(), checkActive: true },
  ]) {
    const outputs = cases.map(({ source }) => [normalizePublicMarkdownContent(source), portablePublicMdxMarkdown(source)]);
    const kept = cases.map(({ markers }, index) =>
      outputs[index].map((output) => markers.reduce((mask, marker, bit) => mask | (output.includes(marker) ? 1 << bit : 0), 0)),
    );
    const sources = createHash('sha256')
      .update(cases.map(({ source }) => source).join('\0'))
      .digest('hex');
    const fixture = {
      revision,
      ...(seed === undefined ? {} : { seed }),
      sources,
      kept,
      ...(checkActive ? { active: outputs.map((pair) => pair.map(activeExportHtml)) } : {}),
    };
    const target = join(here, `${name}.main-19522197.json`);
    writeFileSync(target, `${JSON.stringify(fixture)}\n`);
    execFileSync(process.execPath, [join(root, 'node_modules/@biomejs/biome/bin/biome'), 'format', '--write', target], { cwd: root });
    console.info(`Recorded ${cases.length} ${name} cases from ${revision}.`);
  }
} finally {
  rmSync(baseline, { recursive: true, force: true });
}
