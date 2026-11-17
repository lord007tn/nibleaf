// @vitest-environment jsdom
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { describe, expect, it } from 'vitest';
import { cleanPastedHTML } from './clean-paste';

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
});
