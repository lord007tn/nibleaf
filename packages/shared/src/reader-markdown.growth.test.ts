import { describe, expect, it } from 'vitest';
import { normalizeMdxBlocks } from './reader-markdown';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
// normalizeMdxBlocks reads each source in time linear in its length: about 4x
// for 4x the input.
describe.runIf(growthTestsEnabled)('normalizeMdxBlocks: growth', () => {
  it.each([
    ['case A', (n: number) => `a${'`'.repeat(n)}${' b'.repeat(n)}`],
    ['case B', (n: number) => '{/* a'.repeat(n)],
    ['case C', (n: number) => '<File a'.repeat(n)],
    ['case D', (n: number) => `<Note>${' a'.repeat(n)}</Note>x`],
  ] as const)(
    'stays linear on %s',
    (_label, build) => {
      const [small, large] = growthMs(normalizeMdxBlocks, build(2000), build(8000), { vary: (text, rep) => `${text} ${rep}` });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
