import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { rewriteMintlifyInternalLinks } from './mintlify-links';

const routes = new Map([['topic/next', '/topic-2/next']]);
const rewrite = (source: string) => rewriteMintlifyInternalLinks(source, 'intro', routes);

describe.runIf(growthTestsEnabled)('link reference definitions: growth', () => {
  it('bounds an unclosed MDX component near the small-page parse cap', () => {
    const source = (n: number) => `[Go][ref]\n\n[ref]: /topic/next\n\n<Note>\n\n${'_a* '.repeat(n)}`;
    const small = source(990);
    const large = source(3960);
    expect(small.length).toBeGreaterThan(3900);
    expect(small.length).toBeLessThan(4096);
    for (const input of [small, large]) expect(rewrite(input)).toBe(input.replace('/topic/next', '/topic-2/next'));
    const [smallMs, largeMs] = growthMs(rewrite, small, large, { minMs: 30 });
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  }, 60_000);

  it.each([
    ['unmatched emphasis delimiters', '_a* ', 1250],
    ['repeated shortcut labels', '[a] ', 5000],
  ] as const)(
    'bounds the rewrite cost on %s',
    (_label, unit, size) => {
      const source = (n: number) => `See [the next page][r].\n\n[r]: /topic/next "T"\n\n${unit.repeat(n)}`;
      const [small, large] = growthMs(rewrite, source(size), source(size * 4), { minMs: 50, budgetMs: 20_000 });
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
