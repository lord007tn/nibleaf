import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';
import { authoredExportText, exportTextInOrder } from './export-html-source';
import { captureExportStructure, compareExportStructure, exportSourceLines } from './export-structure';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { inspectExport as inspect, newlyLiveFeatures } from './testing/export-oracle';
import { reviewedExportCases } from './testing/export-review-cases';
import { expandedExportStructureCases, exportContentHazardCases, exportInertContextCases } from './testing/export-structure-cases';
import { markdownCorpus } from './testing/markdown-corpus';

const ceilings = JSON.parse(readFileSync(new URL('./__fixtures__/markdown-export.fallback-ceilings.json', import.meta.url), 'utf8')) as Record<
  string,
  { ceiling: number; expandedCeiling: number; indices: number[]; expandedIndices: number[] }
>;

const mode = vi.hoisted(() => ({ main: false }));
vi.mock('./export-html', async (original) => {
  const actual = await original<typeof import('./export-html')>();
  return { ...actual, escapeDisallowedExportHtml: (source: string) => (mode.main ? source : actual.escapeDisallowedExportHtml(source)) };
});
it.each([
  ['expanded', expandedExportStructureCases, 19_800],
  ['hazards', exportContentHazardCases, 3030],
  ['contexts', exportInertContextCases, 2415],
  ['review', reviewedExportCases, 17_090],
  // The repository corpus grows whenever docs are added, so its count is a
  // floor (the 352 pages reviewed in #652); docs edits never fail CI on count.
  ['corpus', () => markdownCorpus(fileURLToPath(new URL('../../..', import.meta.url))).map(([, source]) => source), 352],
] as const)(
  'preserves structure, source text and inert content: %s',
  (_label, build, count) => {
    const cases = build();
    const failures: unknown[] = [];
    const totals = {
      exports: 0,
      live: 0,
      newFeatures: 0,
      structure: 0,
      textLoss: 0,
      inactiveChanges: 0,
      bounded: 0,
      unpreservable: 0,
      expanded: 0,
      codeChanges: 0,
      throws: 0,
    };
    const allowedFallbacks = new Set(ceilings[_label]?.indices ?? []);
    const allowedExpanded = new Set(ceilings[_label]?.expandedIndices ?? []);
    for (const [index, source] of cases.entries())
      for (const [target, project] of [normalizePublicMarkdownContent, portablePublicMdxMarkdown].entries()) {
        mode.main = true;
        const baseline = project(source);
        mode.main = false;
        let output: string;
        try {
          output = project(source);
        } catch (error) {
          totals.throws++;
          if (failures.length < 8) failures.push({ index, target, error: String(error) });
          continue;
        }
        const before = inspect(baseline);
        const after = inspect(output);
        const model = captureExportStructure(baseline, before.tokens);
        const comparison = compareExportStructure(model, output, after.tokens);
        const newlyLive = newlyLiveFeatures(before.features, after.features);
        if (comparison.unpreservable) {
          totals.unpreservable++;
          totals.expanded += Number(comparison.expanded);
          if (comparison.expanded && !allowedExpanded.has(index * 2 + target) && failures.length < 8)
            failures.push({ index, target, reason: 'new expanded rescue' });
          if (!allowedFallbacks.has(index * 2 + target) && failures.length < 8) failures.push({ index, target, reason: 'new unpreservable shape' });
          for (const range of model.rescue ?? model.literal ?? [])
            if (!exportTextInOrder(authoredExportText(baseline.slice(range.from, range.to)), after.text)) {
              totals.textLoss++;
              if (failures.length < 8) failures.push({ index, target, reason: 'fallback lost visible text' });
            }
        }
        if (model.risky && !comparison.unpreservable) {
          const lines = exportSourceLines(baseline);
          for (const range of model.literal ?? []) {
            const run = model.runs[range.run];
            const expected =
              run && range.from === lines[run.start]?.start && range.to === (lines[run.end]?.start ?? baseline.length)
                ? before.tokens
                    .slice(run.first, run.last + 1)
                    .map((token) => token.content)
                    .join('')
                : baseline.slice(range.from, range.to);
            if (!exportTextInOrder(authoredExportText(expected), after.text)) {
              totals.textLoss++;
              if (failures.length < 8) failures.push({ index, target, reason: 'literal run lost visible text' });
            }
          }
        }
        totals.exports++;
        totals.live += after.elements;
        totals.newFeatures += newlyLive;
        totals.codeChanges += Number(comparison.unpreservable && !comparison.outsideCodeStable);
        totals.structure += Number(!comparison.equal && !comparison.unpreservable);
        totals.textLoss += Number(!comparison.preserved);
        totals.inactiveChanges += Number(!before.elements && baseline !== output);
        totals.bounded += comparison.unpreservable ? (model.rescue ?? model.literal ?? []).length * 2 : comparison.boundaryCount;
        if (
          (after.elements || newlyLive || (!comparison.equal && !comparison.unpreservable) || (!before.elements && baseline !== output)) &&
          failures.length < 8
        )
          failures.push({ source, baseline, output, live: after.elements, newlyLive, structure: comparison.equal, preserved: comparison.preserved });
      }
    console.info(_label, totals);
    expect({
      failures,
      live: totals.live,
      newFeatures: totals.newFeatures,
      structure: totals.structure,
      textLoss: totals.textLoss,
      inactiveChanges: totals.inactiveChanges,
      throws: totals.throws,
      codeChanges: totals.codeChanges,
    }).toEqual({ failures: [], live: 0, newFeatures: 0, structure: 0, textLoss: 0, inactiveChanges: 0, throws: 0, codeChanges: 0 });
    expect(totals.unpreservable).toBeLessThanOrEqual(ceilings[_label]?.ceiling ?? -1);
    expect(totals.expanded).toBeLessThanOrEqual(ceilings[_label]?.expandedCeiling ?? -1);
    if (_label === 'corpus') expect([totals.unpreservable, totals.expanded]).toEqual([0, 0]);
    // Generated matrices are exact; the repository corpus only has a floor.
    if (_label !== 'corpus') expect(cases.length).toBe(count);
    else expect(cases.length).toBeGreaterThanOrEqual(count);
  },
  // The full 39,600-export row took 8.7s locally; CI has shown 28x slowdown.
  300_000,
);

const reviewedBoundaries = [
  '> <script></script>\n> <a>\n\tCODE',
  '- <pre><script></script>\n\n  TEXT\n- NEXT',
  '- <script></script>\n  <a>\n- NEXT',
  '- <script></script>\n      CODE\n- NEXT',
  '-\t<script></script>\n        CODE\n- NEXT',
  '- <script data-x="\0"></script>\n      CODE\n- NEXT',
  '- <script>BODY\n  </textarea>\n      CODE\n  <img onerror="NEW_ATTACK()">\n  </script>\n- NEXT',
];
it.each(
  reviewedBoundaries.flatMap((source) =>
    [
      ['LF', '\n'],
      ['CRLF', '\r\n'],
      ['CR', '\r'],
    ].map(([label, ending]) => ({ label, source: source.replaceAll('\n', ending ?? '\n') })),
  ),
)('pins the reviewed boundary ($label): $source', ({ source }) => {
  mode.main = true;
  const baseline = portablePublicMdxMarkdown(source);
  mode.main = false;
  const output = portablePublicMdxMarkdown(source);
  const before = inspect(baseline),
    after = inspect(output);
  expect(after.elements).toBe(0);
  const comparison = compareExportStructure(captureExportStructure(baseline, before.tokens), output, after.tokens);
  expect(comparison.equal || comparison.unpreservable).toBe(true);
});
