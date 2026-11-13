import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { convertGitBookMarkdown } from './gitbook-markdown';

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('GitBook conversion growth', () => {
  it('keeps Liquid container-prefix scanning linear for many tokens on one line and many lines', () => {
    const input = (n: number) =>
      `- Step\n\n  ${'{% embed url="https://youtu.be/abcdefghijk" %}'.repeat(n)}\n\n${'  {% embed url="https://youtu.be/abcdefghijk" %}\n\n'.repeat(n)}`;
    const convert = (source: string) => convertGitBookMarkdown(source, { resolveFile: () => undefined });
    const [small, large] = growthMs(convert, input(512), input(2048));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
  it.each(['details', 'figure', 'picture', 'table data-view="cards"', 'div', 'a class="button"'])(
    'converts a MiB of unclosed %s openings in linear time',
    (tag) => {
      const unit = `<${tag}>`;
      const input = (bytes: number) => unit.repeat(Math.ceil(bytes / unit.length));
      const convert = (markdown: string) => convertGitBookMarkdown(markdown, { resolveFile: () => undefined });
      // 4x the input costs about 4x (testing/growth); quadratic work would be 16x.
      const [small, large] = growthMs(convert, input(256 * 1024), input(1024 * 1024));
      expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
    },
  );
});
