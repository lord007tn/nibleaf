import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import {
  checkExportBaseline,
  EXPORT_BASELINE_REVISION,
  type ExportGuardBaseline,
  recordExportBaseline,
  renderedActiveHtml,
} from './testing/export-guard';
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
  'keeps element-inactive main output byte-identical, preserves main code and emits zero active elements: $label',
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

it('adds zero active elements in the 13 portable outputs caught by the round-4 review', () => {
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

it('rejects preserved fence bytes hidden inside an HTML comment', () => {
  const source = '<script>ACTIVE</script>\n\n~~~html\nSAMPLE\n~~~';
  const cases = [{ index: 0, source, markers: ['SAMPLE'] }];
  const baseline = { revision: EXPORT_BASELINE_REVISION, ...recordExportBaseline(cases, [(s) => s, (s) => s]) };
  const corrupt = () => '&lt;script>ACTIVE&lt;/script>\n\n<!--\n~~~html\nSAMPLE\n~~~\n-->';
  const report = checkExportBaseline(cases, baseline, [corrupt, corrupt]);
  expect(report.stats.map((stats) => stats.changedCode)).toEqual([1, 1]);
});

it.each([
  { name: 'order', code: '~~~\nONE\n~~~\n\n~~~\nTWO\n~~~\n', changed: '~~~\nTWO\n~~~\n\n~~~\nONE\n~~~\n' },
  { name: 'occurrences', code: '~~~\nSAME\n~~~\n\n~~~\nSAME\n~~~\n', changed: '~~~\nSAME\n~~~\n' },
  { name: 'role', code: '`SAMPLE`', changed: '~~~\n`SAMPLE`\n~~~' },
])('rejects changed code $name even when every sample occurs in the source', ({ code, changed }) => {
  const source = `<script>ACTIVE</script>\n\n${code}`;
  const cases = [{ index: 0, source, markers: [] }];
  const baseline = { revision: EXPORT_BASELINE_REVISION, ...recordExportBaseline(cases, [(s) => s, (s) => s]) };
  const corrupt = () => `&lt;script>ACTIVE&lt;/script>\n\n${changed}`;
  const report = checkExportBaseline(cases, baseline, [corrupt, corrupt]);
  expect(report.stats.map((stats) => stats.changedCode)).toEqual([1, 1]);
});

it('rejects code introduced into a changed output whose main output had none', () => {
  const source = '<script>ACTIVE</script>\n\nTEXT';
  const cases = [{ index: 0, source, markers: ['TEXT'] }];
  const baseline = { revision: EXPORT_BASELINE_REVISION, ...recordExportBaseline(cases, [(s) => s, (s) => s]) };
  const corrupt = () => '&lt;script>ACTIVE&lt;/script>\n\nTEXT\n\n~~~\nNEW\n~~~';
  const report = checkExportBaseline(cases, baseline, [corrupt, corrupt]);
  expect(report.stats.map((stats) => stats.changedCode)).toEqual([1, 1]);
});

it('accepts source code revealed by neutralizing an unclosed active element, in source order only', () => {
  const source = '> <style>\n> ~~~\n> KEPT\n> ~~~\n\nTEXT';
  const cases = [{ index: 0, source, markers: ['TEXT'] }];
  const baseline = { revision: EXPORT_BASELINE_REVISION, ...recordExportBaseline(cases, [(s) => s, (s) => s]) };
  const revealed = () => '> &lt;style>\n> ~~~\n> KEPT\n> ~~~\n\nTEXT';
  const reordered = () => '> &lt;style>\n> ~~~\n> TEXT\n> ~~~\n\nKEPT';
  expect(checkExportBaseline(cases, baseline, [revealed, revealed]).stats.map((stats) => stats.changedCode)).toEqual([0, 0]);
  expect(checkExportBaseline(cases, baseline, [reordered, reordered]).stats.map((stats) => stats.changedCode)).toEqual([1, 1]);
});
