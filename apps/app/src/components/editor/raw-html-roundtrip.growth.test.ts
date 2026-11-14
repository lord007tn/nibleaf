// @vitest-environment jsdom
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { annotateFences } from './fence-source';
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

  // Tags that never close: each `<` after the first must not rescan the rest of the page.
  it.each([
    ['<iframe ', '<iframe '],
    ['<iframe src="', '<iframe src="'],
    ['<div title="', '<div title="'],
    ['<span ', '<span '],
    ['<Card title="', '<Card title="'],
    ['<script> with no closing tag', '<script>'],
    ['{ expression', '{ '],
    ['{" expression', '{"'],
    ['<iframe { (a brace that never closes)', '<iframe {'],
    ['<Card x={', '<Card x={'],
    ['<iframe <Card title=" <span {', '<iframe <Card title=" <span { '],
  ])('prepares a page of unclosed %s in one pass', (_name, tag) => {
    const [small, large] = growthMs(parse, tag.repeat(1000), tag.repeat(4000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});

type MarkdownToken = Parameters<typeof annotateFences>[0]['tokens'][number];
type FenceMarkdown = {
  block: { parse(source: string, md: unknown, env: object, tokens: MarkdownToken[]): void };
  core: { State: new (source: string, md: unknown, env: object) => { Token: new (type: string, tag: string, nesting: 1 | 0 | -1) => MarkdownToken } };
};

/** `n` list items, each a fence that opens on the item's first line (#578). */
const itemFences = (n: number) => '- ```js\n  x\n  ```\n'.repeat(n);
/** `n` components, each holding a fence the editor keeps whole (#589): quoted with a
 *  tab and a longer closer, then in a list item. */
const groupedFences = (n: number) =>
  '<CodeGroup>\n>\t```md\n>\t[Tour](https://youtu.be/abcdefghijk)\n>\t````\n</CodeGroup>\n\n<CodeGroup>\n- ```md\n  <Card title="x" />\n  ````\n</CodeGroup>\n\n'.repeat(
    n,
  );

describe.runIf(growthTestsEnabled)('code fence source growth', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  const { parser } = (editor.storage as unknown as MarkdownStorage).markdown;
  parser.parse('');
  const md = parser.md as unknown as FenceMarkdown;
  const parse = (source: string) => parser.md.parse(source, {});
  afterAll(() => editor.destroy());

  it('gives the fences of a long list their source and lead paragraphs in one pass', () => {
    // Only the fence rule is timed, on block tokens made beforehand. Each call gets
    // a fresh copy of the token list (linear), since the rule adds lead paragraphs to it.
    const { Token } = new md.core.State('', md, {});
    const input = (n: number) => {
      const src = itemFences(n);
      const tokens: MarkdownToken[] = [];
      md.block.parse(src, md, {}, tokens);
      return { src, tokens };
    };
    const annotate = ({ src, tokens }: { src: string; tokens: MarkdownToken[] }) => {
      const state = { src, tokens: [...tokens], Token };
      annotateFences(state);
      return state.tokens.length;
    };
    // Inserting each lead paragraph into the token list moved every token after it: 16x.
    const [small, large] = growthMs(annotate, input(8000), input(32_000), { budgetMs: 20_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('prepares a page of list item fences in one pass', () => {
    const [small, large] = growthMs(parse, itemFences(1000), itemFences(4000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('prepares a page of components holding fences only the reader reads in one pass', () => {
    const [small, large] = growthMs(parse, groupedFences(250), groupedFences(1000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });
});
