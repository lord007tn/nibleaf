import { constantGrowthLimit, growthMs, growthTestsEnabled } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { normalizeDomainInput } from './index';

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('normalizeDomainInput growth', () => {
  it('stays fast on long runs of whitespace and dots', () => {
    const hostile = (n: number) => `a${' '.repeat(n)}.${' '.repeat(n)}`.repeat(4);
    // The input is capped before any work, so 4x the input costs the same
    // (testing/growth, constant bound).
    const [small, large] = growthMs(normalizeDomainInput, hostile(12_500), hostile(50_000), { minMs: 12 });
    expect(large).toBeLessThanOrEqual(constantGrowthLimit(small));
  });
});
