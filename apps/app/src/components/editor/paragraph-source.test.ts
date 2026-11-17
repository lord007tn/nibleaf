// @vitest-environment jsdom
/**
 * Hard-wrapped paragraphs keep their source lines on save (P1-ED-001): at the top
 * level and inside lists, quotes and components, in English and Arabic, while an
 * edited paragraph is written in the canonical single line.
 */
import { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));

import { joinedSourceLines } from './paragraph-source';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from './tiptap-editor';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function load(markdown: string): Editor {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  seedMarkdown(editor, markdown);
  return editor;
}

/** What a save writes for an untouched page (the serializer never ends with a newline). */
const saved = (markdown: string) => getMarkdown(load(markdown));

/** Replace the first `word` with `replacement`, as typing would. */
function replaceWord(editor: Editor, word: string, replacement: string) {
  let from = -1;
  editor.state.doc.descendants((node, pos) => {
    if (from >= 0) return false;
    const index = node.isText ? (node.text ?? '').indexOf(word) : -1;
    if (index >= 0) from = pos + index;
    return from < 0;
  });
  if (from < 0) throw new Error(`No ${word}`);
  editor.view.dispatch(editor.state.tr.insertText(replacement, from, from + word.length));
}

describe('joinedSourceLines', () => {
  it.each([
    ['one line', 'just one line', null],
    ['two lines', 'first line\nsecond line', 'first line second line'],
    ['continuation indent', 'first line\n   second line', 'first line second line'],
    ['one trailing space', 'first line \nsecond line', 'first line second line'],
    ['a hard break (two spaces)', 'first line  \nsecond line', null],
    ['a hard break (backslash)', 'first line\\\nsecond line', null],
    ['Arabic', 'السطر الأول\nالسطر الثاني', 'السطر الأول السطر الثاني'],
  ])('%s', (_name, source, joined) => {
    expect(joinedSourceLines(source)).toBe(joined);
  });
});

describe('an untouched hard-wrapped paragraph saves as written', () => {
  it.each([
    ['at the top level', 'A paragraph that is wrapped\nacross two lines.\n\nAnd a second one,\nalso wrapped.'],
    ['in Arabic', 'فقرة ملفوفة\nعلى سطرين.\n\nوفقرة ثانية\nملفوفة أيضًا.'],
    ['in a tight bullet list', '- An item that wraps\n  onto a second line.\n- A short item.'],
    ['in a loose bullet list', '- An item that wraps\n  onto a second line.\n\n- A short item.'],
    ['in an ordered list', '1. An item that wraps\n   onto a second line.\n2. A short item.'],
    ['in a nested list', '- Outer item\n  - Inner item that wraps\n    onto a second line.\n  - Inner short.\n- Outer short.'],
    ['in a quote', '> A quoted paragraph\n> that wraps.'],
    ['in a Note', '<Note>\n\nA note that wraps\nacross two lines.\n\n</Note>'],
    ['in an Accordion', '<AccordionGroup>\n\n<Accordion title="Q">\n\nAn answer that wraps\nacross two lines.\n\n</Accordion>\n\n</AccordionGroup>'],
    ['in a Step', '<Steps>\n\n<Step title="One">\n\nA step that wraps\nacross two lines.\n\n</Step>\n\n</Steps>'],
    ['in a Tab', '<Tabs>\n\n<Tab title="npm">\n\nA tab that wraps\nacross two lines.\n\n</Tab>\n\n</Tabs>'],
    ['in a Card', '<CardGroup cols="2">\n\n<Card title="A" href="/a">\n\nA card that wraps\nacross two lines.\n\n</Card>\n\n</CardGroup>'],
    ['in an Arabic Accordion', '<AccordionGroup>\n\n<Accordion title="سؤال">\n\nجواب يلتف\nعلى سطرين.\n\n</Accordion>\n\n</AccordionGroup>'],
    ['with marks and links', 'Hit **Publish** and read\nthe [guide](/guide) with `code`\nat the end.'],
  ])('%s', (_name, markdown) => {
    expect(saved(markdown)).toBe(markdown);
  });

  it('keeps a line that ends in bold, code or a link apart from the next word', () => {
    // tiptap-markdown used to delete the line break after an element: "boldnext".
    const markdown = 'Use **bold**\nnext, then `code`\nand a [link](/a)\nhere.';
    expect(saved(markdown)).toBe(markdown);
    const editor = load(markdown);
    expect(editor.state.doc.textContent).toBe('Use bold next, then code and a link here.');
  });

  it('keeps a tight list tight', () => {
    expect(saved('- One that wraps\n  here.\n- Two.\n- Three.')).not.toContain('\n\n');
  });

  it('leaves a paragraph with a hard break to the serializer, as before', () => {
    expect(saved('First line  \nsecond line.')).toBe('First line\\\nsecond line.');
  });
});

describe('an edited paragraph', () => {
  const page = 'First paragraph that wraps\nacross two lines.\n\nSecond paragraph that wraps\nacross two lines too.';

  it('is written on one line, and the paragraphs around it keep their lines', () => {
    const editor = load(page);
    replaceWord(editor, 'Second', 'Next');
    expect(getMarkdown(editor)).toBe('First paragraph that wraps\nacross two lines.\n\nNext paragraph that wraps across two lines too.');
  });

  it('is written on one line after a mark change, though its text is the same', () => {
    const editor = load('Some words that wrap\nacross two lines.');
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && from < 0) from = pos;
    });
    editor
      .chain()
      .setTextSelection({ from, to: from + 4 })
      .toggleBold()
      .run();
    expect(getMarkdown(editor)).toBe('**Some** words that wrap across two lines.');
  });

  it('gets its source lines back when the edit is undone', () => {
    const editor = load(page);
    // A separate history step from the seed, as an edit made after loading is.
    editor.view.dispatch(closeHistory(editor.state.tr));
    replaceWord(editor, 'Second', 'Next');
    editor.commands.undo();
    expect(getMarkdown(editor)).toBe(page);
  });

  it('split in two: neither half claims the source lines', () => {
    const editor = load('Words before the split and\nwords after it.');
    let at = -1;
    editor.state.doc.descendants((node, pos) => {
      const index = node.isText ? (node.text ?? '').indexOf('split') : -1;
      if (index >= 0 && at < 0) at = pos + index;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
    editor.commands.splitBlock();
    // Either half may carry the attribute (a split copies attributes), but its text
    // no longer reads as the source, so neither writes the source lines.
    const halves = getMarkdown(editor).split('\n\n');
    expect(halves.map((half) => half.trimEnd())).toEqual(['Words before the', 'split and words after it.']);
  });
});
