import { describe, expect, it } from 'vitest';
import { offsetInRanges, pageContentFacts } from './publish-checks';
import { rewriteReaderEmbeds, scanAuthoredEmbeds } from './reader-embeds';
import { normalizeMdxBlocks } from './reader-markdown';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from './testing/growth';
import { isAllowedMediaUrl, parseVideoUrl } from './video-embeds';

// Timing bounds, run on their own (pnpm test:growth; see testing/growth).
const sizes = (unit: string, count: number): [string, string] => [unit.repeat(count), unit.repeat(count * 4)];
const linear = (run: (input: string) => unknown, [small, large]: [string, string]) => {
  const [smallMs, largeMs] = growthMs(run, small, large);
  expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
};

describe.runIf(growthTestsEnabled)('reader embed growth', () => {
  it('rewrites long unclosed iframe openers in linear time', () => {
    linear(rewriteReaderEmbeds, sizes('<iframe src="https://youtu.be/x" ', 20_000));
    linear(normalizeMdxBlocks, sizes('<iframe src="https://youtu.be/x" ', 5000));
  });

  it('rewrites iframe openers with no space before the next opener in linear time', () => {
    linear(rewriteReaderEmbeds, sizes('<iframe<iframe ', 20_000));
  });

  it('rewrites long attribute values with no closing quote in linear time', () => {
    linear(rewriteReaderEmbeds, [`<iframe title="${'a'.repeat(50_000)}`, `<iframe title="${'a'.repeat(200_000)}`]);
    linear(rewriteReaderEmbeds, sizes('<iframe title="aaaaaaaaaa ', 20_000));
    linear(rewriteReaderEmbeds, sizes("<iframe src={'aaaaaaaa ", 20_000));
    linear(rewriteReaderEmbeds, sizes('<iframe src={{{{{{{{ ', 20_000));
  });

  it('rewrites many complete iframe openers with no closer in linear time', () => {
    linear(rewriteReaderEmbeds, sizes('<iframe src="https://youtu.be/x">text ', 20_000));
    linear(rewriteReaderEmbeds, sizes('<iframe src="https://youtu.be/x"></ifram </iframe x ', 20_000));
    linear(normalizeMdxBlocks, sizes('<iframe src="https://youtu.be/x">\n', 5000));
  });

  it('rewrites many video tags without a close in linear time', () => {
    linear(rewriteReaderEmbeds, sizes('<video controls src="https://cdn.example.com/a.mp4" ', 20_000));
    linear(rewriteReaderEmbeds, sizes('<video\n  controls\n', 20_000));
    linear(normalizeMdxBlocks, sizes('<video controls\n', 5000));
  });

  it('scans iframes and videos for the editor in linear time', () => {
    linear(scanAuthoredEmbeds, sizes('<iframe src="https://youtu.be/x">text ', 20_000));
    linear(scanAuthoredEmbeds, sizes('<video controls src="https://cdn.example.com/a.mp4">\n<source src="a" />\n', 20_000));
    linear(scanAuthoredEmbeds, sizes('<video src="a"></vide </video x <iframe src="b"></ifram ', 20_000));
    linear(scanAuthoredEmbeds, sizes('<iframe src="https://youtu.be/x"></iframe>\n<video src="a.mp4"></video>\n\n', 10_000));
  });

  it('rewrites long src values built from repeated segments in linear time', () => {
    linear(rewriteReaderEmbeds, sizes('<iframe src="https://www.youtube.com/embed/embed/embed/embed/embed/embed/"></iframe>\n', 5000));
    linear(rewriteReaderEmbeds, sizes(`<iframe src="https://www.youtube.com/${'a/'.repeat(1000)}"></iframe>\n`, 200));
    linear(rewriteReaderEmbeds, [
      `<iframe src="https://www.youtube.com/${'embed/'.repeat(20_000)}"></iframe>`,
      `<iframe src="https://www.youtube.com/${'embed/'.repeat(80_000)}"></iframe>`,
    ]);
    linear(parseVideoUrl, [`https://www.youtube.com/${'embed/'.repeat(300)}`, `https://www.youtube.com/${'embed/'.repeat(1200)}`]);
    linear(isAllowedMediaUrl, [`https://cdn.example.com/${'a/'.repeat(250)}`, `https://cdn.example.com/${'a/'.repeat(1000)}`]);
  });

  it('collects embed publish checks in linear time', () => {
    const page = '<iframe src="https://codepen.io/x"></iframe>\n\n<video src="http://cdn.example.com/a.mp4"></video>\n\n';
    linear((content) => pageContentFacts(content, false), sizes(page, 100));
  });

  it('checks embeds and links against many raw HTML title ranges in linear time', () => {
    // Every <title> is a range the checks skip; every <video> and link after one is checked against them.
    const videos = '<title>t</title>\n\n<video src="http://cdn.example.com/a.mp4"></video>\n\n';
    linear((content) => pageContentFacts(content, false), sizes(videos, 250));
    const links = '<title>t</title>\n\n<a href="/guide">Guide</a>\n\n';
    linear((content) => pageContentFacts(content, false), sizes(links, 250));
  }, 120_000);

  it('rewrites many unclosed iframes, each followed by text, with one closer at the end, in linear time', () => {
    const unclosed = (count: number) => `${'<iframe src="https://youtu.be/dQw4w9WgXcQ">\n\nSome text after it.\n\n'.repeat(count)}</iframe>`;
    linear(rewriteReaderEmbeds, [unclosed(20_000), unclosed(80_000)]);
    linear(normalizeMdxBlocks, [unclosed(2000), unclosed(8000)]);
  }, 120_000);

  it('looks up many offsets in many skipped ranges in linear time', () => {
    // The lookup the embed and link checks use: one range per <title>, one offset per element, in document order.
    const page = (count: number) => ({
      ranges: Array.from({ length: count }, (_, index) => ({ start: index * 10, end: index * 10 + 4 })),
      offsets: Array.from({ length: count }, (_, index) => index * 10 + 6),
    });
    const lookup = ({ ranges, offsets }: ReturnType<typeof page>) => {
      const inRange = offsetInRanges(ranges);
      return offsets.filter(inRange).length;
    };
    const [smallMs, largeMs] = growthMs(lookup, page(4000), page(16_000));
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  }, 120_000);
});
