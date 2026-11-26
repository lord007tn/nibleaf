import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { checkExportBaseline, EXPORT_BASELINE_REVISION, type ExportGuardBaseline, recordExportBaseline } from './testing/export-guard';
import { EXPORT_GUARD_SEED, htmlExportBoundaryCases, seededExportCases } from './testing/export-guard-cases';

const projectors = [normalizePublicMarkdownContent, portablePublicMdxMarkdown] as const;
const matrices = [
  { label: 'review 2640', count: 2640, cases: htmlExportBoundaryCases(), seed: undefined },
  { label: 'seed 0xc611babe', count: 4096, cases: seededExportCases(), seed: EXPORT_GUARD_SEED },
] as const;
// The 4096 baseline was recorded on main, except for the public export of cases
// 376 and 2188: markdown-it 15 reads the double-backtick span in each as CommonMark
// and micromark do, so their `code` and `codeTokens` entries were re-recorded.
// The exported bytes did not change.
const readBaseline = (count: number): ExportGuardBaseline =>
  JSON.parse(
    readFileSync(new URL(`./__fixtures__/markdown-export.guard.main-2cf12d3f.${count}.json`, import.meta.url), 'utf8'),
  ) as ExportGuardBaseline;

it.each(matrices)(
  'keeps element-inactive main output byte-identical, preserves main code and emits zero active elements: $label',
  (matrix) => {
    const baseline = readBaseline(matrix.count);
    const report = checkExportBaseline(matrix.cases, baseline, projectors);
    if (matrix.cases.length !== matrix.count) report.metadata.push('wrong case count');
    if (baseline.seed !== matrix.seed) report.metadata.push('wrong seed');
    console.info(`Export guard ${matrix.count} correctness`, {
      public: report.stats[0],
      portable: report.stats[1],
    });
    const limits = JSON.parse(readFileSync(new URL('./__fixtures__/markdown-export.fallback-ceilings.json', import.meta.url), 'utf8')) as Record<
      string,
      { ceiling: number; expandedCeiling: number; indices: number[]; expandedIndices: number[] }
    >;
    expect(report.stats.reduce((sum, stats) => sum + stats.unpreservable, 0)).toBeLessThanOrEqual(limits[`guard${matrix.count}`]?.ceiling ?? -1);
    const limit = limits[`guard${matrix.count}`];
    expect(report.stats.reduce((sum, stats) => sum + stats.expanded, 0)).toBeLessThanOrEqual(limit?.expandedCeiling ?? -1);
    const known = new Set(limit?.indices),
      knownExpanded = new Set(limit?.expandedIndices);
    expect(report.unpreservableCases.every((id) => known.has(id))).toBe(true);
    expect(report.expandedCases.every((id) => knownExpanded.has(id))).toBe(true);
    // One aggregated assertion, never expect() inside the marker loop. Hashes
    // report output changes for review; payload/order/activity are the gate.
    expect({ metadata: report.metadata, failures: report.failures.slice(0, 12) }, `${report.failures.length} invariant failures`).toEqual({
      metadata: [],
      failures: [],
    });
  },
  60_000,
);

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

it.each([
  { source: '<style>\n~~~\n> KEPT\n~~~\n</style>', output: '&lt;style>\n~~~\nKEPT\n~~~\n&lt;/style>' },
  { source: '<style>\n~~~\nONE\nSKIPPED\nTWO\n~~~\n</style>', output: '&lt;style>\n~~~\nONE\nTWO\n~~~\nSKIPPED\n&lt;/style>' },
])('rejects corruption of revealed source spans: $source', ({ source, output }) => {
  const cases = [{ index: 0, source, markers: [] }];
  const baseline = { revision: EXPORT_BASELINE_REVISION, ...recordExportBaseline(cases, [(s) => s, (s) => s]) };
  const report = checkExportBaseline(cases, baseline, [() => output, () => output]);
  expect(report.stats.map((stats) => stats.changedCode)).toEqual([1, 1]);
});

it('retains CRLF and literal quote characters when removing one uniform revealed-code prefix', () => {
  const source = '<style>\r\n~~~\r\n\r\n> KEPT\r\n~~~\r\n</style>';
  const quoted = source
    .split('\n')
    .map((line) => (line === '\r' ? '>\r' : `> ${line}`))
    .join('\n');
  const cases = [{ index: 0, source, markers: ['KEPT'] }];
  const baseline = { revision: EXPORT_BASELINE_REVISION, ...recordExportBaseline(cases, [() => quoted, () => quoted]) };
  const output = quoted.replaceAll('<style>', '&lt;style>').replaceAll('</style>', '&lt;/style>');
  const report = checkExportBaseline(cases, baseline, [() => output, () => output]);
  expect(report.failures).toEqual([]);
});

it.each([
  ['<script>ACTIVE</script>\n\nKeep *emphasis* here.', '&lt;script>ACTIVE&lt;/script>\n\nKeep &#42;emphasis&#42; here.'],
  ['<script>ACTIVE</script>\n\nTEXT', '***\n&lt;script>ACTIVE&lt;/script>\n\nTEXT'],
])('rejects round-11 forbidden edits in the full guard: %s', (source, output) => {
  const cases = [{ index: 0, source, markers: [] }];
  const baseline = { revision: EXPORT_BASELINE_REVISION, ...recordExportBaseline(cases, [(s) => s, (s) => s]) };
  const report = checkExportBaseline(cases, baseline, [() => output, () => output]);
  expect(report.stats.map((stats) => stats.structuralChanges)).toEqual([1, 1]);
});

it('rejects changed bytes after an expanded rescue in the full guard', () => {
  const source = '- <script>BODY</script>\n  FOLLOW\n\nOutside *emphasis* here.';
  const cases = [{ index: 0, source, markers: [] }];
  const baseline = { revision: EXPORT_BASELINE_REVISION, ...recordExportBaseline(cases, [(s) => s, (s) => s]) };
  const output = portablePublicMdxMarkdown(source).replaceAll('Outside *emphasis* here.', 'Outside &#42;emphasis&#42; here.');
  expect(checkExportBaseline(cases, baseline, [() => output, () => output]).stats.map((stats) => stats.structuralChanges)).toEqual([1, 1]);
});
