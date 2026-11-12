// @vitest-environment jsdom
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions } from './tiptap-editor';

type MarkdownStorage = { markdown: { parser: { parse(content: string): unknown; md: { parse(source: string, env: object): unknown } } } };

/** `n` embeds, each a block of its own. */
const embeds = (n: number) => '<iframe/>\n\n'.repeat(n);
/** `n` components, each holding an embed, a comment, inline HTML and an expression. */
const mixed = (n: number) =>
  '<Card title="A">\n\n<video controls src="/a.mp4"></video>\n\n<!-- note -->\n\nText <kbd>K</kbd> and {value}.\n\n</Card>\n\n'.repeat(n);

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('raw HTML preparation growth', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  const { parser } = (editor.storage as unknown as MarkdownStorage).markdown;
  // The first parse installs the editor's Markdown rules; time the parse itself,
  // without building the document.
  parser.parse('');
  const parse = (source: string) => parser.md.parse(source, {});
  afterAll(() => editor.destroy());

  it('prepares a page of embeds in one pass', () => {
    // 4x the embeds costs about 4x; comparing every range with every other would be 16x.
    const [small, large] = growthMs(parse, embeds(1000), embeds(4000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('prepares a page of components holding embeds, comments and expressions in one pass', () => {
    const [small, large] = growthMs(parse, mixed(250), mixed(1000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
