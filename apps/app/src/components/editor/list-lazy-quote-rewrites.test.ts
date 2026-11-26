// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterAll, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from './tiptap-editor';

const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
afterAll(() => editor.destroy());

it.each([
  ['English', 'Alpha', 'Bravo'],
  ['Arabic', 'الصفحة', 'المحرر'],
])('keeps authored lazy quotes in list items in %s over ten saves (#638)', (_language, first, second) => {
  for (const [opener, continuation] of [
    ['- > ', '  '],
    ['- > ', ''],
    ['2. > > ', '   > '],
    ['2. >> ', '   > '],
    ['- - > ', '    '],
    ['> - > ', '>   '],
  ]) {
    for (const end of ['', '  ', '\\']) {
      const source = `${opener}${first}${end}\n${continuation}${second}`;
      let saved = source;
      for (let cycle = 0; cycle < 10; cycle++) {
        seedMarkdown(editor, saved);
        saved = getMarkdown(editor);
        expect(saved, JSON.stringify(source)).toBe(source);
      }
    }
  }
});

it.each(['+', '*'])('keeps lazy quote wrapping when the %s list bullet is normalized', (bullet) => {
  const quote = ' > Alpha\n  Bravo\n  > Char';
  seedMarkdown(editor, bullet + quote);
  const saved = getMarkdown(editor);
  expect(saved).toBe(`-${quote}`);
  seedMarkdown(editor, saved);
  expect(getMarkdown(editor)).toBe(saved);
});
