import { describe, expect, it } from 'vitest';
import { protectMarkdownCode } from './markdown-code';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('protectMarkdownCode growth', () => {
  it('restores a large page with many fences in one pass', () => {
    const fences = (n: number) => protectMarkdownCode('```\n'.repeat(n));
    // Restoring 4x the fences costs about 4x (testing/growth); one pass per fence would be 16x.
    const [small, large] = growthMs((code: ReturnType<typeof protectMarkdownCode>) => code.restore(code.content), fences(25_000), fences(100_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
