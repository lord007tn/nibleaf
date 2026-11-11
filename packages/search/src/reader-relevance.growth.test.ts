import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { cleanSearchText, readerSearchTerms } from './index';

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
// ReDoS bounds (CodeQL js/polynomial-redos): untrusted queries and page bodies
// must stay linear. Each row's large input is the size it always used.
describe.runIf(growthTestsEnabled)('published reader relevance: growth', () => {
  it.each([
    ['spaces, then one letter', (n: number) => `${' '.repeat(n - 1)}x`, 240_000],
    ['letter-space pairs', (n: number) => 'a '.repeat(n / 2), 100_000],
    ['open brackets', (n: number) => '[('.repeat(n / 2), 320_000],
    ['unclosed comments', (n: number) => '<!--'.repeat(n / 4), 400_000],
    ['backticks', (n: number) => '`'.repeat(n), 600_000],
    ['unbalanced code spans', (n: number) => '`a``'.repeat(n / 4), 64_000],
    ['unclosed fences', (n: number) => '```\n'.repeat(n / 4), 64_000],
    ['unclosed tags, then one letter', (n: number) => `${'<T>'.repeat(n / 3)}x`, 78_000],
  ] as const)('stays linear on adversarial input: %s', (_label, build, n) => {
    const read = (input: string) => [readerSearchTerms(input), cleanSearchText(input)];
    const [small, large] = growthMs(read, build(n), build(4 * n));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
