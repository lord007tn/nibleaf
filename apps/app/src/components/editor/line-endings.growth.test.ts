// @vitest-environment jsdom
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { readLineEndings, restoreLineEndings } from './line-endings';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from './tiptap-editor';

/** `n` hard-wrapped paragraphs, each three lines long, numbered so each line is its own. */
const wrapped = (n: number) =>
  Array.from(
    { length: n },
    (_, index) => `Paragraph ${index} wrapped by hand, with **bold**\nat the end of a line and a [link](/a)\nbefore the last one.`,
  ).join('\n\n');
/** `page` with every third line ending in LF and the others in CRLF. */
const mixed = (page: string) =>
  page.split('\n').reduce((out, line, index) => (index === 0 ? line : out + (index % 3 === 0 ? '\n' : '\r\n') + line), '');
/** The save of `page` after edits to its first and last paragraphs: every line between them is matched again. */
const editedAtBothEnds = (page: string) => page.replace('Paragraph 0 ', 'Edited 0 ').replace(/before the last one\.$/, 'edited.');

// Timing bounds, run on their own (pnpm test:growth; see @nibleaf/shared/testing/growth).
describe.runIf(growthTestsEnabled)('line endings growth (#702)', () => {
  it('puts back a mixed page’s line endings after edits at both ends in one pass, 4,000 paragraphs against 1,000', () => {
    const at = (n: number) => {
      const source = mixed(wrapped(n));
      return { source: readLineEndings(source), saved: editedAtBothEnds(wrapped(n)) };
    };
    const small = at(1000);
    const large = at(4000);
    expect(restoreLineEndings(large.source, large.saved)).toBe(mixed(editedAtBothEnds(wrapped(4000))));
    const restore = ({ source, saved }: ReturnType<typeof at>) => restoreLineEndings(source, saved);
    const [smallMs, largeMs] = growthMs(restore, small, large, { budgetMs: 20_000 });
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });

  it('saves an edited CRLF page of 2,000 wrapped paragraphs in one pass, against 500', () => {
    const at = (n: number) => {
      const page = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
      seedMarkdown(page, wrapped(n).replaceAll('\n', '\r\n'));
      // An edit to the first paragraph: its lines no longer match, and the save is matched line by line.
      page.view.dispatch(page.state.tr.insertText('Edited ', 1));
      return page;
    };
    const small = at(500);
    const large = at(2000);
    try {
      const first = wrapped(1);
      const expected = `Edited ${first.replaceAll('\n', ' ')}${wrapped(2000).slice(first.length)}`;
      expect(getMarkdown(large)).toBe(expected.replaceAll('\n', '\r\n'));
      const [smallMs, largeMs] = growthMs(getMarkdown, small, large, { budgetMs: 60_000 });
      expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
    } finally {
      small.destroy();
      large.destroy();
    }
  }, 120_000);
});
