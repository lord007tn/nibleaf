import { describe, expect, it } from 'vitest';
import { needsRichMarkdown, replaceHtmlTags } from './reader-rich';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('rich content detection growth', () => {
  it('scales linearly on long unclosed tag runs', () => {
    const [small, large] = growthMs(needsRichMarkdown, '<A'.repeat(20_000), '<A'.repeat(80_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('scales linearly on long runs of dollar signs', () => {
    const [small, large] = growthMs(needsRichMarkdown, '$a'.repeat(20_000), '$a'.repeat(80_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('scales linearly on long runs of inline code markers', () => {
    const [small, large] = growthMs(needsRichMarkdown, '`a``'.repeat(20_000), '`a``'.repeat(80_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('replaces tags in long unclosed tag runs linearly', () => {
    const [small, large] = growthMs((text: string) => replaceHtmlTags(text, ' '), '<A'.repeat(20_000), '<A'.repeat(80_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
