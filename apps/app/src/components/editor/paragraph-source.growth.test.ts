// @vitest-environment jsdom
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from './tiptap-editor';

type MarkdownStorage = { markdown: { parser: { parse(content: string): unknown; md: { parse(source: string, env: object): unknown } } } };

/** `n` hard-wrapped paragraphs, each three lines long. */
const wrapped = (n: number) =>
  'A paragraph wrapped by hand, with **bold**\nat the end of a line and a [link](/a)\nbefore the last one.\n\n'.repeat(n);
/** `n` tight list items in a list nested three deep, each item wrapped. */
const nestedLists = (n: number) => `- Outer\n  - Middle\n${'    - An item that wraps\n      onto a second line.\n'.repeat(n)}`;

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('paragraph source lines growth', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  const { parser } = (editor.storage as unknown as MarkdownStorage).markdown;
  // The first parse installs the editor's Markdown rules; time markdown-it itself.
  parser.parse('');
  const parse = (source: string) => parser.md.parse(source, {});
  afterAll(() => editor.destroy());

  it('reads the source lines of a page of wrapped paragraphs in one pass', () => {
    const [small, large] = growthMs(parse, wrapped(1000), wrapped(4000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  it('reads the source lines of wrapped items in nested tight lists in one pass', () => {
    const [small, large] = growthMs(parse, nestedLists(1000), nestedLists(4000), { budgetMs: 10_000 });
    expect(large).toBeLessThanOrEqual(linearGrowthLimit(small));
  });

  // #612's sizes. Main: 8.2 → 261 ms per call for 500 → 2,000 paragraphs, since each
  // paragraph checked and cut back the whole output written before it.
  it('saves a page of 2,000 wrapped paragraphs in one pass, against 500', () => {
    const at = (n: number) => {
      const page = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
      seedMarkdown(page, wrapped(n));
      return page;
    };
    const small = at(500);
    const large = at(2000);
    try {
      const [smallMs, largeMs] = growthMs(getMarkdown, small, large, { budgetMs: 60_000 });
      console.info(
        `#612 save growth, wrapped paragraphs 500 → 2,000: ${smallMs.toFixed(1)} → ${largeMs.toFixed(1)} ms (limit ${linearGrowthLimit(smallMs).toFixed(1)})`,
      );
      expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
    } finally {
      small.destroy();
      large.destroy();
    }
    // Loading the two pages takes seconds on a loaded runner, before any timing.
  }, 120_000);

  it('writes a page of untouched wrapped paragraphs back in one pass', () => {
    const at = (n: number) => {
      const page = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
      seedMarkdown(page, wrapped(n));
      return page;
    };
    const small = at(250);
    const large = at(1000);
    try {
      expect(getMarkdown(large)).toBe(wrapped(1000).trimEnd());
      const [smallMs, largeMs] = growthMs(getMarkdown, small, large, { budgetMs: 20_000 });
      expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
    } finally {
      small.destroy();
      large.destroy();
    }
  });
});
