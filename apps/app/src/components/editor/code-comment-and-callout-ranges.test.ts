// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

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

const save = (page: string) => getMarkdown(open(page));

/** The first save gives `expected`, and nine more load/save cycles give it again. */
const expectSettled = (page: string, expected = page) => {
  let saved = save(page);
  expect(saved).toBe(expected);
  for (let cycle = 1; cycle < 10; cycle++) {
    saved = save(saved);
    expect(saved).toBe(expected);
  }
};

const T = '```';
const NOTE = '<Note title="Heads up" data-id="note-1">\n\nBody\n\n</Note>';

/*
 * A `<!--` in indented code is code, not a comment opener (#624). Read as one, an
 * unterminated `<!--` ran to the end of the page and hid every component tag after
 * it: a `<Note>` saved as `> [!NOTE]`, without its attributes, and an unknown
 * component lost its tags. The editor writes indented code as a fenced block (as it
 * always has), so these pages settle in that form, with every tag kept as written.
 */
describe('a <!-- in code (#624)', () => {
  it('leaves the <Note> after an unterminated <!-- in indented code as written', () => {
    expectSettled(`Intro.\n\n    code <!-- not a comment\n\n${NOTE}\n\nAfter.`, `Intro.\n\n${T}\ncode <!-- not a comment\n${T}\n\n${NOTE}\n\nAfter.`);
  });

  it('reads the tags after a <!-- in indented code, then in fenced and inline code', () => {
    expectSettled(
      `Intro.\n\n    code <!-- one\n\n${T}\n<!-- two\n${T}\n\nSee \`<!-- three\` here.\n\n${NOTE}`,
      `Intro.\n\n${T}\ncode <!-- one\n${T}\n\n${T}\n<!-- two\n${T}\n\nSee \`<!-- three\` here.\n\n${NOTE}`,
    );
  });

  it('reads the tags after a <!-- in indented code inside a list item', () => {
    expectSettled(`- item\n\n      code <!-- x\n\n${NOTE}`, `- item\n\n  ${T}\n  code <!-- x\n  ${T}\n\n${NOTE}`);
  });

  it('keeps an unknown component after a <!-- in indented code', () => {
    expectSettled(
      'Intro.\n\n    code <!-- x\n\n<Widget size="2">\n\nBody\n\n</Widget>',
      `Intro.\n\n${T}\ncode <!-- x\n${T}\n\n<Widget size="2">\n\nBody\n\n</Widget>`,
    );
  });
});

/*
 * A range kept byte for byte over several lines, inside HTML the editor writes as a
 * quote (a `<div data-callout>` saved as `> [!NOTE]`, a `<blockquote>`), was written
 * with only its first line quoted. The next load read the rest as other blocks, so the
 * second save changed the page again (#806). The container is kept whole now.
 */
describe('a component kept byte for byte inside a callout container (#806)', () => {
  const repro = '<div data-callout>\n<Accordion title={oops>\nText\n</div>\n\n# Outside\n\n</Accordion>';

  it('settles in the first save: the reported page and its variants', () => {
    for (const page of [
      repro,
      '<div data-callout>\n<Accordion title="oops>\nText\n</div>\n\n# Outside\n\n</Accordion>',
      '<div data-callout>\n<card title={oops>\nText\n</div>\n\n# Outside\n\n</card>',
      '<div data-callout>\n<div data-mdx="Card" title={oops>\nText\n</div>\n\n# Outside\n\n</div>',
    ]) {
      const first = save(page);
      expect(save(first)).toBe(first);
    }
  });

  it.each([
    ['the reported page', repro],
    ['an unterminated quoted value', '<div data-callout>\n<Accordion title="oops>\nText\n</div>\n\n# Outside\n\n</Accordion>'],
    ['no closing tag after it', '<div data-callout>\n<Accordion title={oops>\nText\n</div>\n\nAfter.'],
    ['a <blockquote>', '<blockquote>\n<Accordion title={oops>\nText\n</blockquote>\n\n# Outside\n\n</Accordion>'],
    ['an unknown component over several lines', '<div data-callout>\n<Widget size="2">\nText\n</Widget>\n</div>\n\nAfter.'],
  ])('saves %s byte for byte', (_name, page) => {
    expectSettled(page);
  });
});
