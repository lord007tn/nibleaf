import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import limits from './__fixtures__/export-664-ceilings.json';
import { compoundShapes } from './__fixtures__/export-664-compound.mjs';
import { newShapes } from './__fixtures__/export-664-generator.mjs';
import { round7, round12 } from './__fixtures__/export-664-review-generators.mjs';
import { export664Corpus } from './testing/export-664-corpus';
import { checkHazardMatrix } from './testing/export-664-guard';
import { htmlExportBoundaryCases, seededExportCases } from './testing/export-guard-cases';
import { reviewedExportCases } from './testing/export-review-cases';
import { expandedExportStructureCases, exportContentHazardCases, exportInertContextCases } from './testing/export-structure-cases';

const matrices = {
  expanded: expandedExportStructureCases,
  hazards: exportContentHazardCases,
  contexts: exportInertContextCases,
  review: reviewedExportCases,
  guard2640: () => htmlExportBoundaryCases().map((row) => row.source),
  guard4096: () => seededExportCases().map((row) => row.source),
  round7,
  round12,
  generator: newShapes,
  compound: compoundShapes,
  corpus: () => export664Corpus(fileURLToPath(new URL('../../..', import.meta.url))).approved.map(([, source]) => source),
};

const descriptions: Partial<Record<keyof typeof matrices, string>> = {
  review: 'mixed HTML and container boundaries',
  round7: 'URL, attribute and element combinations',
  round12: 'inert contexts, containers and mixed line endings',
};

it.each((Object.keys(matrices) as Array<keyof typeof matrices>).map((name) => ({ name, description: descriptions[name] ?? name })))(
  'renders every output and preserves inert main bytes, visible author text and outside structure: $description',
  ({ name }) => {
    const report = checkHazardMatrix(matrices[name]());
    console.info(JSON.stringify({ matrix: name, ...report.totals, inactiveHash: report.inactiveHash }));
    const ceiling = limits.matrices[name];
    expect(report.totals.exports).toBe(ceiling.exports);
    expect(report.failures, JSON.stringify(report.failures)).toEqual([]);
    expect(report.totals.fallbacks).toBeLessThanOrEqual(ceiling.ceiling);
    expect(report.totals.expanded).toBeLessThanOrEqual(ceiling.expandedCeiling);
    const allowed = new Set<number>(ceiling.indices),
      expanded = new Set<number>(ceiling.expandedIndices);
    expect(report.fallbackIds.every((id) => allowed.has(id))).toBe(true);
    expect(report.expandedIds.every((id) => expanded.has(id))).toBe(true);
  },
  300_000,
);

it('checks additional corpus pages without weakening the two approved fallback exceptions', () => {
  const pages = export664Corpus(fileURLToPath(new URL('../../..', import.meta.url))).additional;
  const report = checkHazardMatrix(pages.map(([, source]) => source));
  expect(report.failures).toEqual([]);
  expect(report.totals.fallbacks).toBe(0);
});
