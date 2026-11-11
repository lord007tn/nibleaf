import { describe, expect, it } from 'vitest';
import { normalizePublicMarkdownContent as md, portablePublicMdxMarkdown as portable } from './public-markdown-content';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth). Linear
// work measures about 4x for 4x the input (deep nesting about 5x, an n log n-like
// term that stays flat from 5k to 320k); quadratic work 16x.
describe.runIf(growthTestsEnabled)('projection robustness (#341): growth', () => {
  it.each([
    ['unmatched backticks', (n: number) => 'a ` b '.repeat(n), 8000],
    ['unclosed tags', (n: number) => '<Note title="x" '.repeat(n), 400],
    ['unclosed quotes', (n: number) => '<Card title="'.repeat(n), 1200],
    ['unbalanced braces', (n: number) => 'x { y '.repeat(n), 6000],
    ['deep quote markers', (n: number) => `${'> '.repeat(n)}x`, 200_000],
    ['deep nesting', (n: number) => `${'<Note>'.repeat(n)}x${'</Note>'.repeat(n)}`, 1500],
  ] as const)(
    'scales linearly on %s',
    (_label, build, n) => {
      const project = (source: string) => [md(source), portable(source)];
      const [small, large] = growthMs(project, build(n), build(4 * n));
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
    60_000,
  );
});
