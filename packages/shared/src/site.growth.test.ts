import { describe, expect, it } from 'vitest';
import { interpolateVariablesWithin } from './site';
import { constantGrowthLimit, growthMs, growthTestsEnabled } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('interpolateVariablesWithin growth', () => {
  it('stops expanding at the limit, so long values cannot amplify a large body', () => {
    const text = '{{x}}'.repeat(200_000);
    const value = 'v'.repeat(500);
    // The work stops at the limit: 4x the body costs the same (testing/growth,
    // constant bound).
    const expand = (body: string) => interpolateVariablesWithin(body, { x: value }, 8192);
    const [small, large] = growthMs(expand, '{{x}}'.repeat(50_000), text, { minMs: 12 });
    expect(large).toBeLessThanOrEqual(constantGrowthLimit(small));
  });
});
