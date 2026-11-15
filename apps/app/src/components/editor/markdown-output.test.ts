// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, describe, expect, it } from 'vitest';
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
