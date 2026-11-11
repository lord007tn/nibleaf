import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { normalizeSearchTerm } from './classifiers';

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('normalizeSearchTerm growth', () => {
  it('redacts in linear time on adversarial input', () => {
    // Each shape at 4x the size costs about 4x (testing/growth); the larger is the size these always used.
    const adversarial = [
      (n: number) => `"${'\\"'.repeat(n / 2)}`,
      (n: number) => `${'a'.repeat(n)}@`,
      (n: number) => `${'@'.repeat(n)}.`,
      (n: number) => `${'a.'.repeat(n / 2)}@x`,
      (n: number) => 'a@'.repeat(n / 2),
      (n: number) => `x@${'b'.repeat(n)}`,
    ];
    for (const build of adversarial) {
      const [small, large] = growthMs(normalizeSearchTerm, build(10_000), build(40_000));
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    }
  });
});
