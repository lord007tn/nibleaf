// @vitest-environment jsdom
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { cleanPasteDOM, cleanPastedHTML } from './clean-paste';

/** A list item whose prose holds `n` soft breaks, followed by a child list. */
const itemWithBreaks = (n: number) => `<ul><li>First${'<br> '.repeat(n)}last<ul><li>Child</li></ul></li></ul>`;

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('cleanPastedHTML growth', () => {
  it('cleans a long run of breaks in one pass', () => {
    // Each call parses a fresh string, so there is no cache to vary around.
    // 4x the breaks costs about 4x; rescanning the run per break would be 16x.
    const [small, large] = growthMs(cleanPastedHTML, itemWithBreaks(2000), itemWithBreaks(8000));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('cleans a roughly 1 MB paste without per-element ancestor walks', () => {
    // Many realistic spans/links, with text dominating the byte size as in articles.
    const fixture = (blocks: number) =>
      `<form>${'<p class="word"><a href="/help"><span style="text-decoration:underline">Read this. </span></a>'.padEnd(4096, 'x').concat('</p>').repeat(blocks)}</form>`;
    /** Cleanup mutates the tree, so each run parses a fresh copy. */
    const clean = (html: string) => {
      const root = document.createElement('div');
      root.innerHTML = html;
      cleanPasteDOM(root);
      return root;
    };
    // 4x the paste costs about 4x (testing/growth); per-element ancestor walks would grow faster.
    const [small, large] = growthMs(clean, fixture(64), fixture(256));
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
