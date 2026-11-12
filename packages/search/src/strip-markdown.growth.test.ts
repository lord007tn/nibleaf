import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { stripMarkdown } from './index';

// Timing bounds, run on their own (pnpm test:growth). Search snippets read the
// whole page through stripMarkdown on every query; these inputs open markup that
// never closes, or are long runs of blank lines, where a regex re-reads the rest
// of the text from every opener or line start.
describe.runIf(growthTestsEnabled)('search snippets: growth', () => {
  it.each([
    ['image labels without ]', (n: number) => '![a'.repeat(n)],
    ['link labels without ]', (n: number) => '[a'.repeat(n)],
    ['links without (', (n: number) => `${'[a'.repeat(n)}]`],
    ['tags without a closing >', (n: number) => '<a b'.repeat(n)],
    ['blank lines', (n: number) => `${'\n'.repeat(n)}x`],
  ])(
    'strips a page of %s in linear time',
    (_label, build) => {
      const [small, large] = growthMs(stripMarkdown, build(3000), build(12_000), { vary: (text, rep) => `${text} ${rep}` });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
