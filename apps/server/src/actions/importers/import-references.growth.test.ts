import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { rewriteMintlifyInternalLinks } from './mintlify-links';

const routes = new Map([['topic/next', '/topic-2/next']]);
const rewrite = (source: string) => rewriteMintlifyInternalLinks(source, 'intro', routes);

describe.runIf(growthTestsEnabled)('link reference definitions: growth', () => {
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
