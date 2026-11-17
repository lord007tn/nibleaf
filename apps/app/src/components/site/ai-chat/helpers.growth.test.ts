import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { answerText } from './helpers';

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('answerText growth', () => {
  // Hostile input stays linear (CodeQL: no backtracking on long marker runs): each shape at 4x the size costs about 4x.
  it('reads hostile citation markers in linear time', () => {
    for (const hostile of [
      (n: number) => `x [S${', '.repeat(n)}y`,
      (n: number) => `x${' '.repeat(n)}y`,
      (n: number) => `x [S1${', S1'.repeat(n / 5)}`,
    ]) {
      const [small, large] = growthMs(answerText, hostile(12_500), hostile(50_000));
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    }
  });
});
