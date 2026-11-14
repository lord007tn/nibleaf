import { describe, expect, it } from 'vitest';
import { fencedMarkdownLines, protectMarkdownCode } from './markdown-code';
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

describe.runIf(growthTestsEnabled)('fencedMarkdownLines growth', () => {
  it('measures whitespace after a quote marker once, including tabs (#595)', () => {
    expect(fencedMarkdownLines(['> \t~~~md', '> literal', '> ~~~', '## After'])).toEqual([true, true, true, false]);
    const page = (n: number) => [`> \t${' '.repeat(n)}~~~md`, '> literal', '> ~~~', '## After'];
    const [small, large] = growthMs(fencedMarkdownLines, page(40_000), page(160_000));
    console.info(`Quote indentation growth: 40,000 vs 160,000 spaces, ${small.toFixed(1)} vs ${large.toFixed(1)} ms`);
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('reads fences in nested quotes and list items in one pass, also where a container ends them', () => {
    // A fence in a list item, quote and list item, with markers in its body that are
    // code, then a quoted fence that a line outside the quote ends (read again).
    const block = ['- > 1. ```md', '  >    example', '  >    > ```', '  >    - ```', '  >    ```', '- > ~~~', '  > code', 'not code', ''];
    const page = (n: number) => Array.from({ length: n }, () => block).flat();
    // 4x the blocks costs about 4x (testing/growth); rescanning per fence would be 16x.
    const [small, large] = growthMs(fencedMarkdownLines, page(5000), page(20_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('reads one fence nested n list items deep in time linear in n', () => {
    // Each list ancestor consumes only its own columns of the body's indentation;
    // rescanning the rest of it per ancestor would be quadratic (#590 council).
    const nested = (depth: number) => [`${'- '.repeat(depth)}\`\`\``, `${' '.repeat(2 * depth)}x`, `${' '.repeat(2 * depth)}\`\`\``, '## After'];
    expect(fencedMarkdownLines(nested(3))).toEqual([true, true, true, false]);
    const [small, large] = growthMs(fencedMarkdownLines, nested(4000), nested(16_000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
