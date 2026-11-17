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
/** `n` Frames whose caption ends in a backslash, read with no escapes (#579). */
const backslashFrames = (n: number) => `<Frame caption="Old\\" data-lightbox>\n  ${I}\n</Frame>\n\n`.repeat(n);
/** `n` unclosed tags and values in a row: each scan must not read the rest of the page again. */
const unclosed = (tag: string, key: string) => (n: number) => `<iframe <${tag} ${key}=" <span { `.repeat(n);

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

  it('reads Frames whose caption ends in a backslash in linear time', () => {
    const [small, large] = growthMs(parse, backslashFrames(300), backslashFrames(1200), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it.each([
    ['Card', 'title'],
    ['Frame', 'caption'],
  ])('scans unclosed %s openers in linear time', (tag, key) => {
    const page = unclosed(tag, key);
    const [small, large] = growthMs(parse, page(1000), page(4000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
