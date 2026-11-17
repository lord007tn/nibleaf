import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { articleStats } from './article-stats';

// Timing bounds, run on their own (pnpm test:growth). The article meta line
// (minutes to read, screenshots) reads the whole page on every render, in time
// linear in its length.
describe.runIf(growthTestsEnabled)('article meta line: growth', () => {
  it.each([
    ['case A', (n: number) => '<a b'.repeat(n)],
    ['case B', (n: number) => '![a'.repeat(n)],
    ['case C', (n: number) => '![a](b'.repeat(n)],
    ['case D', (n: number) => '<img a'.repeat(n)],
  ])(
    'stays linear on %s',
    (_label, build) => {
      const [small, large] = growthMs(articleStats, build(3000), build(12_000), { vary: (text, rep) => `${text} ${rep}` });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
