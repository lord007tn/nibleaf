import { createHash } from 'node:crypto';
import { checkOutside } from '../__fixtures__/export-664-outside.mjs';
import { authoredExportText, exportTextEnd, mayHaveActiveExportHtml, readExportHtml, type ExportHtmlMetrics } from '../export-html-source';
import { captureExportStructure, compareExportStructure, literalExportText } from '../export-structure';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from '../public-markdown-content';
import * as main from '../__fixtures__/export-main-reference';
import { inspectExport } from './export-oracle';

export const exportTargets = [
  { name: 'public', project: normalizePublicMarkdownContent, baseline: main.normalizePublicMarkdownContent },
  { name: 'portable', project: portablePublicMdxMarkdown, baseline: main.portablePublicMdxMarkdown },
] as const;

/** Every output is fully rendered and parsed, even when byte-identical or
 * skipped by either production filter. No source scanner is an activity oracle. */
export const checkHazardMatrix = (sources: Iterable<string>) => {
  const totals = {
    exports: 0,
    active: 0,
    inactiveChanges: 0,
    textLoss: 0,
    outsideBytes: 0,
    outsideStructure: 0,
    outsideCode: 0,
    throws: 0,
    unsafeSkips: 0,
    skips: 0,
    tokenSkips: 0,
    fallbacks: 0,
    expanded: 0,
  };
  const fallbackIds: number[] = [],
    expandedIds: number[] = [];
  const failures: Array<{ index: number; target: string; reason: string }> = [];
  const inactive = createHash('sha256');
  let index = 0;
  for (const source of sources) {
    for (const [target, { name, project, baseline: mainProject }] of exportTargets.entries()) {
      const fail = (reason: string) => {
        if (failures.length < 12) failures.push({ index, target: name, reason });
      };
      try {
        const baseline = mainProject(source),
          output = project(source);
        const before = inspectExport(baseline),
          after = inspectExport(output);
        const metrics: ExportHtmlMetrics = { generatedBytes: 0, replayBytes: 0, replayAnalyses: 0 };
        const state = readExportHtml(baseline, { hazards: true, metrics });
        totals.exports++;
        totals.active += after.active;
        if (after.active) fail('remaining active construct');
        if (!before.active) {
          inactive.update(baseline).update('\0');
          if (baseline !== output) {
            totals.inactiveChanges++;
            fail('inert main bytes changed');
          }
        }
        const sourceSkip = !mayHaveActiveExportHtml(baseline);
        totals.skips += Number(sourceSkip);
        totals.tokenSkips += Number(metrics.skip === 'tokens');
        if ((sourceSkip || metrics.skip === 'tokens') && before.active) {
          totals.unsafeSkips++;
          fail('unsafe prefilter skip');
        }
        if (!state) {
          if (output !== baseline) {
            totals.outsideBytes++;
            fail('changed without ownership');
          }
          continue;
        }
        const model = captureExportStructure(baseline, state.tokens, state);
        const comparison = compareExportStructure(model, output, after.tokens, true);
        const canonical = literalExportText(model, true);
        if (comparison.unpreservable) {
          totals.fallbacks++;
          fallbackIds.push(index * 2 + target);
          if (comparison.expanded) {
            totals.expanded++;
            expandedIds.push(index * 2 + target);
          }
        }
        // Canonical output explicitly copies every byte between owned regions.
        if (output !== canonical || !comparison.preserved) {
          totals.outsideBytes++;
          fail('outside bytes changed');
        }
        if (!checkOutside(model, output, before.tokens, after.tokens, authoredExportText)) {
          totals.outsideStructure++;
          fail('outside root structure changed');
        }
        if (!comparison.outsideCodeStable) {
          totals.outsideCode++;
          fail('outside code changed');
        }
        let cursor = 0;
        for (const region of model.rescue ?? model.literal ?? []) {
          cursor = exportTextEnd(authoredExportText(baseline.slice(region.from, region.to)), after.text, cursor);
          if (cursor < 0) {
            totals.textLoss++;
            fail('owned author text lost');
            break;
          }
        }
      } catch (error) {
        totals.throws++;
        fail(String(error));
      }
    }
    index++;
  }
  return { totals, fallbackIds, expandedIds, inactiveHash: inactive.digest('hex'), failures };
};

/** Both definition length and reference count grow together. */
export const exportFanoutSource = (n: number, prefix: string): string =>
  prefix + '\n\nOn this page:\n\n[ref]: https://example.test/' + 'a'.repeat(n) + ' "' + 'b'.repeat(n) + '"\n\n' + '[x][ref] '.repeat(n);
