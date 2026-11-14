import { describe, expect, it } from 'vitest';
import { readerEmbedSource } from './reader-embeds';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';
import { parseVideoUrl } from './video-embeds';

describe.runIf(growthTestsEnabled)('video URL guard growth', () => {
  it('checks complete long reader inputs with linear growth before applying the existing clip', () => {
    const url = (length: number) => `https://www.youtube.com/watch?v=M7lc1UVf-VE&extra=${'a'.repeat(length)}`;
    const small = url(2000);
    const large = url(8000);
    expect(readerEmbedSource(large)?.kind).toBe('video');
    expect(readerEmbedSource(`${large}\n`)?.kind).not.toBe('video');
    const [smallMs, largeMs] = growthMs(readerEmbedSource, small, large);
    console.info(`complete reader guard n=2000 / 4n=8000: ${smallMs.toFixed(2)} ms / ${largeMs.toFixed(2)} ms (${(largeMs / smallMs).toFixed(2)}x)`);
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });

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
