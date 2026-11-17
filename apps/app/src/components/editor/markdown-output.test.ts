// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
import { MarkdownOutput } from './markdown-output';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * Exact-output regressions for the editor's own serializer state (#612). Its
 * bold/italic trimming reads only a short window behind each run instead of the
 * whole output. The window must reach two UTF-16 units back: a run can follow an
 * astral character (one code point, two units), and a one-unit window then reads
 * half a surrogate pair and decides the run's flanking wrongly. The 1,000-page
 * differential has astral emoji but not an astral letter right before a run that
 * starts with punctuation, so this pins that boundary on its own.
 */
describe('editor Markdown output: exact boundaries', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());

  const paragraph = (...content: object[]) => ({ type: 'doc', content: [{ type: 'paragraph', content }] });
  const text = (value: string, marks?: string[]) => ({ type: 'text', text: value, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) });

  it.each([
    // Found by the independent review of #693: a one-unit window gives `𝔄**!x**z`.
    ['bold after an astral letter, starting with punctuation', paragraph(text('𝔄'), text('!x', ['bold']), text('z')), '𝔄!**x**z'],
    ['italic after an astral letter, starting with punctuation', paragraph(text('𝔄'), text('!x', ['italic']), text('z')), '𝔄!*x*z'],
    ['bold after a BMP letter, starting with punctuation', paragraph(text('A'), text('!x', ['bold']), text('z')), 'A!**x**z'],
  ])('%s', (_name, doc, expected) => {
    editor.commands.setContent(doc);
    expect(getMarkdown(editor).trim()).toBe(expected);
  });
});

describe('a page’s line endings across a dry run of setContent (#702)', () => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  afterAll(() => editor.destroy());

  it('`editor.can().setContent(…)` replaces nothing, so the page keeps its CRLF endings', () => {
    const page = 'One.\r\n\r\nTwo.\r\n\r\nThree.';
    editor.commands.setContent(page, { emitUpdate: false });
    // TipTap runs a capability check without `dispatch`: no document is set.
    expect(editor.can().setContent('Other.')).toBe(true);
    expect(getMarkdown(editor)).toBe(page);
    editor.view.dispatch(editor.state.tr.insertText('Edited ', 1));
    expect(getMarkdown(editor)).toBe('Edited One.\r\n\r\nTwo.\r\n\r\nThree.');
  });
});

// A component's tight layout (#606) reads its children's first and last lines back and
// puts a blank line in before them: each reads one line only, across the pieces written.
describe('the output read back next to a component’s tags (#606)', () => {
  const written = (...pieces: string[]) => {
    const output = new MarkdownOutput();
    for (const piece of pieces) output.append(piece);
    return output;
  };

  it('`lastLine` is the last line, without a line break that ends it', () => {
    expect(written('<Note>\n', '| A ', '| B |\n').lastLine()).toBe('| A | B |');
    expect(written('<Note>\nTe', 'xt').lastLine()).toBe('Text');
    expect(written('a\n', '\n').lastLine()).toBe('');
    expect(written().lastLine()).toBe('');
    const long = written('x'.repeat(10_000), '\n', 'tail');
    const before = long.charactersRead;
    expect(long.lastLine()).toBe('tail');
    expect(long.charactersRead - before).toBeLessThanOrEqual(5);
  });

  it('`lineFrom` reads to the next line break; `insertAt` puts text in before what follows', () => {
    const output = written('<Note>\n', '> ', 'quo', 'ted\nTail');
    expect(output.lineFrom(7)).toBe('> quoted');
    expect(output.lineFrom(9)).toBe('quoted');
    output.insertAt(7, '\n');
    output.insertAt(output.length, '\n');
    expect(output.length).toBe(22);
    expect(output.sliceFrom(0)).toBe('<Note>\n\n> quoted\nTail\n');
  });
});
