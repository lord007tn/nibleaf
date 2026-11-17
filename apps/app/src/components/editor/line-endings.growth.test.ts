// @vitest-environment jsdom
import { writeFileSync } from 'node:fs';
import { growthMs, growthTestsEnabled, linearGrowthLimit } from '@nibleaf/shared/testing/growth';
import { Editor } from '@tiptap/core';
import { Mapping, StepMap } from '@tiptap/pm/transform';
import { describe, expect, it } from 'vitest';
import { createPositionedLineEndings, mapLineEndings, type PositionedLine, readLineEndings, restoreLineEndings } from './line-endings';
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
  it('maps endings through an edit in 1M characters against 250k, in linear work (#754)', () => {
    const at = (characters: number) => {
      const body = `${'x'.repeat(48)}\n`.repeat(Math.floor((characters - 12) / 49));
      const page = `\`\`\`text\n${body}${'x'.repeat(characters - 12 - body.length)}\n\`\`\``;
      expect(page.length).toBe(characters);
      let number = 0;
      const source = readLineEndings(page.replace(/\n/g, () => (++number % 3 ? '\r\n' : '\n')));
      if (!source) throw new Error('Expected mixed endings');
      const rows = page.split('\n');
      let position = 1;
      const lines: PositionedLine[] = rows.map((text, index) => {
        const from = index === 0 ? 0 : position;
        const to = index === 0 ? 1 : from + text.length;
        if (index > 0) position = to + 1;
        return { from, to, text, newline: index < rows.length - 1, part: index === 0 ? 'start' : 'code', slot: 0, assoc: 1 };
      });
      return {
        state: createPositionedLineEndings(source, () => ({ markdown: page, lines })),
        mapping: new Mapping([new StepMap([Math.floor(characters / 2), 0, 1])]),
      };
    };
    const small = at(250_000);
    const large = at(1_000_000);
    const apply = ({ state, mapping }: ReturnType<typeof at>) => mapLineEndings(state, mapping);
    expect(apply(large).anchors).toHaveLength(large.state.anchors.length);
    const [smallMs, largeMs] = growthMs(apply, small, large, { budgetMs: 20_000 });
    console.info(`[line-ending-position-growth] 250k ${smallMs.toFixed(3)} ms, 1M ${largeMs.toFixed(3)} ms`);
    if (process.env.LINE_ENDINGS_GROWTH_OUT)
      writeFileSync(
        process.env.LINE_ENDINGS_GROWTH_OUT,
        `${JSON.stringify({ smallCharacters: 250_000, largeCharacters: 1_000_000, smallMs, largeMs })}\n`,
      );
    expect(largeMs).toBeLessThanOrEqual(linearGrowthLimit(smallMs));
  });

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
