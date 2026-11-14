import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { checkExportBaseline, type ExportGuardBaseline, renderedActiveHtml } from './testing/export-guard';
import { EXPORT_GUARD_SEED, htmlExportBoundaryCases, PORTABLE_REGRESSION_IDS, seededExportCases } from './testing/export-guard-cases';

const projectors = [normalizePublicMarkdownContent, portablePublicMdxMarkdown] as const;
const matrices = [
  { label: 'review 2640', count: 2640, cases: htmlExportBoundaryCases(), seed: undefined },
  { label: 'seed 0xc611babe', count: 4096, cases: seededExportCases(), seed: EXPORT_GUARD_SEED },
] as const;
const readBaseline = (count: number): ExportGuardBaseline =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/markdown-export.guard.main-2cf12d3f.${count}.json`, import.meta.url), 'utf8'),
  ) as ExportGuardBaseline;

it.each(matrices)(
  'keeps main author text and source code bytes, with no more active HTML than the reader: $label',
  (matrix) => {
    const start = performance.now();
    const baseline = readBaseline(matrix.count);
    const report = checkExportBaseline(matrix.cases, baseline, projectors);
    if (matrix.cases.length !== matrix.count) report.metadata.push('wrong case count');
    if (baseline.seed !== matrix.seed) report.metadata.push('wrong seed');
    console.info(`Export guard ${matrix.count}: ${(performance.now() - start).toFixed(1)} ms`, {
      public: report.stats[0],
      portable: report.stats[1],
    });
    // One aggregated assertion, never expect() inside the marker loop. Hashes
    // report output changes for review; payload/order/activity are the gate.
    expect({ metadata: report.metadata, failures: report.failures.slice(0, 12) }, `${report.failures.length} invariant failures`).toEqual({
      metadata: [],
      failures: [],
    });
  },
  60_000,
);

it('adds zero active HTML in the 13 portable outputs caught by the round-4 review', () => {
  const matrix = matrices[1];
  const baseline = readBaseline(matrix.count);
  const failures: number[] = [];
  for (const index of PORTABLE_REGRESSION_IDS) {
    const example = matrix.cases[index];
    const floor = baseline.active[index]?.[1];
    if (!example || typeof floor !== 'number' || renderedActiveHtml(portablePublicMdxMarkdown(example.source)) > floor) failures.push(index);
  }
  expect(failures).toEqual([]);
}, 60_000);
