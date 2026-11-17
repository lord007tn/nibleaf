import { describe, expect, it } from 'vitest';
import { markdownToPlainText } from './markdown-text';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
describe.runIf(growthTestsEnabled)('markdownToPlainText on adversarial input (ReDoS, CodeQL js/polynomial-redos)', () => {
  // Author content reaches this on every render and on the public OG route, so
  // each case must stay linear: timed at n and 4n repetitions against itself
  // (testing/growth). The largest input is the size these cases always used.
  // Extraction caches by content, so every call gets a fresh, equivalent input:
  // a unique number after the text (testing/growth `vary`).
  const fresh = { vary: (input: string, rep: number) => `${input} ${rep}` };
  const cases: Array<[string, (n: number) => string, number]> = [
    ['unclosed comments', (n) => '<!--'.repeat(n), 25_000],
    ['unclosed script elements', (n) => '<script'.repeat(n), 25_000],
    ['script open tags without a close', (n) => '<script>'.repeat(n), 25_000],
    ['unclosed tags', (n) => '<a'.repeat(n), 25_000],
    ['unclosed closing tags', (n) => '</a'.repeat(n), 25_000],
    ['unclosed brackets', (n) => '['.repeat(n), 25_000],
    ['reference-style link prefixes', (n) => '[a]['.repeat(n), 12_500],
    ['image reference prefixes', (n) => '![a]['.repeat(n), 12_500],
    // micromark's emphasis resolution is superlinear: about 750 ms for 16 KB of
    // `*a` when parsed directly. The marker guard sends it to the linear strip.
    ['dense emphasis (16 KB of *a)', (n) => '*a'.repeat(n), 2048],
    ['dense underscores', (n) => '_a'.repeat(n), 2048],
  ];

  // Every dense case above takes the linear strip.
  it.each(cases)('stays linear on %s', (_, build, n) => {
    const [small, large] = growthMs(markdownToPlainText, build(n), build(4 * n), fresh);
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  // Just under the 200-marker guard the parser legitimately runs, on the 1.5 KB
  // prefix; both sizes stay under the guard (the larger is the size this case
  // always used). micromark's superlinear paths would show as growth here.
  it.each([
    ['emphasis just under the marker guard', (n: number) => '*aaaaaaa'.repeat(n), 48],
    ['tags just under the marker guard', (n: number) => `<b>${'a'.repeat(13)}`.repeat(n), 24],
  ] as const)('stays bounded on %s', (_, build, n) => {
    expect(markdownToPlainText(build(4 * n))).toContain('a');
    const [small, large] = growthMs(markdownToPlainText, build(n), build(4 * n), fresh);
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
