import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { articleStats } from './article-stats';

// Timing bounds, run on their own (pnpm test:growth). The article meta line
// (minutes to read, screenshots) reads the whole page on every render; these
// inputs open markup that never closes.
describe.runIf(growthTestsEnabled)('article meta line: growth', () => {
  it.each([
    ['tags without a closing >', (n: number) => '<a b'.repeat(n)],
    ['image labels without ]', (n: number) => '![a'.repeat(n)],
    ['images without )', (n: number) => '![a](b'.repeat(n)],
    ['image tags without a closing >', (n: number) => '<img a'.repeat(n)],
  ])(
    'counts a page of %s in linear time',
    (_label, build) => {
      const [small, large] = growthMs(articleStats, build(3000), build(12_000), { vary: (text, rep) => `${text} ${rep}` });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
