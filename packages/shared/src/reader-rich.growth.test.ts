import { describe, expect, it } from 'vitest';
import { needsRichMarkdown } from './reader-rich';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('rich renderer detection growth', () => {
  it('reads many tag starts with no closing `>` in one pass', () => {
    // A regular expression retried from every `<` scanned to the end each time: 4x the starts cost 16x.
    const [small, large] = growthMs(needsRichMarkdown, '<A'.repeat(20_000), '<A'.repeat(80_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('reads many dollar signs in one pass', () => {
    const [small, large] = growthMs(needsRichMarkdown, '$a'.repeat(20_000), '$a'.repeat(80_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('drops many unmatched inline code runs in one pass', () => {
    const [small, large] = growthMs(needsRichMarkdown, '`a``'.repeat(20_000), '`a``'.repeat(80_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
