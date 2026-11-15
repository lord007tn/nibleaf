import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import limits from './__fixtures__/export-664-ceilings.json';
import { compoundShapes } from './__fixtures__/export-664-compound.mjs';
import { newShapes } from './__fixtures__/export-664-generator.mjs';
import { round7, round12 } from './__fixtures__/export-664-review-generators.mjs';
import { checkHazardMatrix } from './testing/export-664-guard';
import { htmlExportBoundaryCases, seededExportCases } from './testing/export-guard-cases';
import { reviewedExportCases } from './testing/export-review-cases';
import { expandedExportStructureCases, exportContentHazardCases, exportInertContextCases } from './testing/export-structure-cases';
import { markdownCorpus } from './testing/markdown-corpus';

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
  corpus: () => markdownCorpus(fileURLToPath(new URL('../../..', import.meta.url))).map(([, source]) => source),
};

it.each(Object.keys(matrices) as Array<keyof typeof matrices>)(
  'renders every output and preserves inert main bytes, visible author text and outside structure: %s',
  (name) => {
    const report = checkHazardMatrix(matrices[name]());
    console.info(name, report.totals, report.inactiveHash);
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
