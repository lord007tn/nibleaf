import { describe, expect, it } from 'vitest';
import { organizationHandleBase } from './organization-handles';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('organizationHandleBase growth', () => {
  it('trims long runs of separators in linear time', () => {
    const name = (n: number) => `${'-'.repeat(n)}acme${'-'.repeat(n)}x`;
    // 4x the separators costs about 4x (testing/growth).
    const [small, large] = growthMs((input: string) => organizationHandleBase(input, 'abcdef123'), name(25_000), name(100_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
