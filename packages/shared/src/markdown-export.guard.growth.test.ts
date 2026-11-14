import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { normalizePublicMarkdownContent, portablePublicMdxMarkdown } from './public-markdown-content';
import { checkExportBaseline, type ExportGuardBaseline } from './testing/export-guard';
import { seededExportCases } from './testing/export-guard-cases';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

describe.runIf(growthTestsEnabled)('export guard growth', () => {
  it('scales linearly over n and 4n committed shapes', () => {
    const cases = seededExportCases();
    const baseline = JSON.parse(
      readFileSync(new URL('./__fixtures__/markdown-export.guard.main-2cf12d3f.4096.json', import.meta.url), 'utf8'),
    ) as ExportGuardBaseline;
    const build = (count: number) => {
      const selected = cases.slice(0, count);
      return {
        cases: selected,
        baseline: {
          ...baseline,
          sources: createHash('sha256')
            .update(selected.map((entry) => entry.source).join('\0'))
            .digest('hex'),
          kept: baseline.kept.slice(0, count),
          active: baseline.active.slice(0, count),
          outputs: baseline.outputs.slice(0, count),
          code: baseline.code.slice(0, count),
          codeTokens: baseline.codeTokens.slice(0, count),
          structure: baseline.structure.slice(0, count),
        },
      };
    };
    const project = ({ cases, baseline }: ReturnType<typeof build>) =>
      checkExportBaseline(cases, baseline, [normalizePublicMarkdownContent, portablePublicMdxMarkdown]);
    const small = build(256),
      large = build(1024);
    const [n, fourN] = growthMs(project, small, large, { minMs: 20 });
    expect(fourN).toBeLessThanOrEqual(linearGrowthLimit(n));
    expect(project(large).failures).toEqual([]);
    console.info(`Guard growth, 256 / 1024 shapes: ${n.toFixed(1)} / ${fourN.toFixed(1)} ms`);
  }, 60_000);
});
