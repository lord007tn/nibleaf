import { describe, expect, it } from 'vitest';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';
import { parseVideoUrl } from './video-embeds';

describe.runIf(growthTestsEnabled)('video URL guard growth', () => {
  it('scans n and 4n characters with linear growth and rejects an unsafe final byte', () => {
    const url = (length: number) => `https://www.youtube.com/watch?v=M7lc1UVf-VE&extra=${'a'.repeat(length)}`;
    const small = url(400);
    const large = url(1600);
    expect(parseVideoUrl(`${small}\t`)).toBeNull();
    expect(parseVideoUrl(`${large}\t`)).toBeNull();
    const [smallMs, largeMs] = growthMs(parseVideoUrl, small, large);
    console.info(`video URL guard n=400 / 4n=1600: ${smallMs.toFixed(2)} ms / ${largeMs.toFixed(2)} ms (${(largeMs / smallMs).toFixed(2)}x)`);
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });
});
