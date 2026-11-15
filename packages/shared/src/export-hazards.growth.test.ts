import { describe, expect, it } from 'vitest';
import { exportFanoutSource, exportTargets } from './testing/export-664-guard';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

describe.runIf(growthTestsEnabled)('handler and URL hardening growth', () => {
  for (const { name, project, baseline } of exportTargets) {
    it.each(['<div>safe</div>', '<img onerror=ATTACK>', '<div title="', "<div title='"])(
      `${name} reference fanout stays linear: %s`,
      (prefix) => {
        const small = exportFanoutSource(128, prefix),
          large = exportFanoutSource(512, prefix);
        const [n, fourN] = growthMs(project, small, large, { minMs: 20, budgetMs: 10_000, samples: 5 });
        expect(fourN).toBeLessThanOrEqual(linearGrowthLimit(n));
        if (prefix.includes('title=')) {
          expect(project(small)).toBe(baseline(small));
          expect(project(large)).toBe(baseline(large));
        }
      },
      120_000,
    );
    it(`${name} ordinary mixed HTML and Markdown grows linearly`, () => {
      const source = '<a href="java&#x09;script:run()">TEXT</a>\n\n- ITEM\n- NEXT\n\n';
      const [n, fourN] = growthMs(project, source.repeat(32), source.repeat(128), { minMs: 20, budgetMs: 10_000, samples: 5 });
      expect(fourN).toBeLessThanOrEqual(linearGrowthLimit(n));
    }, 120_000);
  }
});
