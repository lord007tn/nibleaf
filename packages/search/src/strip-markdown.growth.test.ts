import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { stripMarkdown } from './index';

// Timing bounds, run on their own (pnpm test:growth). Search snippets read the
// whole page through stripMarkdown on every query, in time linear in its length.
describe.runIf(growthTestsEnabled)('search snippets: growth', () => {
  it.each([
    ['case A', (n: number) => '![a'.repeat(n)],
    ['case B', (n: number) => '[a'.repeat(n)],
    ['case C', (n: number) => `${'[a'.repeat(n)}]`],
    ['case D', (n: number) => '<a b'.repeat(n)],
    ['case E', (n: number) => `${'\n'.repeat(n)}x`],
  ])(
    'stays linear on %s',
    (_label, build) => {
      const [small, large] = growthMs(stripMarkdown, build(3000), build(12_000), { vary: (text, rep) => `${text} ${rep}` });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
