// @vitest-environment jsdom
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions } from './tiptap-editor';

type MarkdownStorage = { markdown: { parser: { parse(content: string): unknown; md: { parse(source: string, env: object): unknown } } } };

const I = '<iframe src="https://www.youtube.com/embed/M7lc1UVf-VE" title="Tour"></iframe>';
/** `n` embeds the Video block opens: alone, in a Frame, and a video. */
const blocks = (n: number) =>
  `${I}\n\n<Frame caption="Tour">\n  ${I}\n</Frame>\n\n<video controls src="https://cdn.example.com/a.mp4"></video>\n\n`.repeat(n);
/** `n` embeds the shared scanner rejects (a `<` in a value), each kept opaque. */
const rejected = (n: number) => `${I.replace('Tour', 'a < b')}\n\n`.repeat(n);
/** `n` Frames whose caption ends in a backslash, read with the MDX grammar (#579). */
const backslashFrames = (n: number) => `<Frame caption="Old\\" data-lightbox aria-label="Tour" {...props}>\n  ${I}\n</Frame>\n\n`.repeat(n);
/** `n` Frame openers the MDX compiler rejects, each kept whole. */
const rejectedFrames = (n: number) => `<Frame caption="a \\"b\\" c">\n  ${I}\n</Frame>\n\n`.repeat(n);
/** One Frame opener with `n` attributes. */
const longOpener = (n: number) => `<Frame caption="Old\\"${' data-x="1" hidden caption2={"}"}'.repeat(n)}>\n  ${I}\n</Frame>`;

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('Video block recognition growth', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  const { parser } = (editor.storage as unknown as MarkdownStorage).markdown;
  parser.parse('');
  const parse = (source: string) => parser.md.parse(source, {});
  afterAll(() => editor.destroy());

  it('reads each opaque range once to recognise the blocks', () => {
    const [small, large] = growthMs(parse, blocks(300), blocks(1200), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('keeps embeds the scanner rejects opaque in one pass', () => {
    const [small, large] = growthMs(parse, rejected(1000), rejected(4000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('reads Frame openers with the MDX grammar in linear time', () => {
    const [small, large] = growthMs(parse, backslashFrames(300), backslashFrames(1200), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('keeps Frame openers the compiler rejects whole in linear time', () => {
    const [small, large] = growthMs(parse, rejectedFrames(300), rejectedFrames(1200), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('reads one opener’s attributes in time linear in their number', () => {
    const [small, large] = growthMs(parse, longOpener(500), longOpener(2000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
