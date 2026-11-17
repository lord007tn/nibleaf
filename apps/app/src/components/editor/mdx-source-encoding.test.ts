// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeMdxSource, encodeMdxSource } from './extensions/mdx-roundtrip';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

/*
 * A lone UTF-16 surrogate (half of a pair, with no partner) is valid in a
 * JavaScript string but not in UTF-8, so encodeURIComponent throws on it. The
 * editor carries kept source through HTML attributes with encodeMdxSource, so a
 * page holding one threw while loading (#805). The code unit is now kept as it
 * is: the page loads and saves byte for byte.
 */

const HIGH = '\uD835';
const LOW = '\uDC00';
const PAIR = '𝐀';

const editors: Editor[] = [];
const open = (markdown: string) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor;
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** Ten load/save cycles each give the page back byte for byte. */
const expectStable = (page: string) => {
  let saved = page;
  for (let cycle = 0; cycle < 10; cycle++) {
    saved = getMarkdown(open(saved));
    expect(saved).toBe(page);
  }
};

describe('encodeMdxSource with lone surrogates (#805)', () => {
  it.each([
    ['a lone high surrogate', HIGH],
    ['a lone low surrogate', LOW],
  ])('keeps %s at the start, the middle and the end of a value', (_name, unit) => {
    for (const value of [`${unit}abc`, `ab${unit}c`, `abc${unit}`, unit, `${unit}${unit}`]) {
      expect(() => encodeMdxSource(value)).not.toThrow();
      expect(decodeMdxSource(encodeMdxSource(value))).toBe(value);
    }
  });

  it('tells a lone surrogate from a pair next to it, and encodes well-formed text as before', () => {
    for (const value of [`${HIGH}${PAIR}`, `${PAIR}${LOW}`, `${LOW}${HIGH}`, `%%${HIGH}%25`]) {
      expect(decodeMdxSource(encodeMdxSource(value))).toBe(value);
    }
    for (const value of ['', 'plain', `a ${PAIR} b`, '100% <Card title="x">', '%%41']) {
      expect(encodeMdxSource(value)).toBe(encodeURIComponent(value));
      expect(decodeMdxSource(encodeMdxSource(value))).toBe(value);
    }
  });
});

describe('a page holding a lone surrogate (#805)', () => {
  // A paragraph wrapped across lines keeps its source lines (paragraph-source), so
  // its text goes through encodeMdxSource.
  describe.each([
    ['high', HIGH],
    ['low', LOW],
  ])('a lone %s surrogate', (_name, unit) => {
    it.each([
      ['at the start of the page', `${unit}First line\nsecond line.`],
      ['in the middle of the page', `Intro.\n\nFirst ${unit} line\nsecond line.\n\nOutro.`],
      ['at the end of the page', `Intro.\n\nFirst line\nsecond line${unit}`],
      ['in a Card title', `Intro.\n\n<Card title="a${unit}b">\n\nBody\n\n</Card>\n\nOutro.`],
      ['in a Card title expression', `<Card title={"${unit}"}>\n\nBody\n\n</Card>`],
      ['in an unknown component attribute', `<Widget label="${unit}">\n\nBody\n\n</Widget>`],
      ['in a raw HTML attribute', `Intro.\n\n<div title="${unit}">\n  Hi\n</div>\n\nOutro.`],
    ])('%s loads and saves byte for byte', (_where, page) => {
      expect(() => getMarkdown(open(page))).not.toThrow();
      expectStable(page);
    });
  });
});
