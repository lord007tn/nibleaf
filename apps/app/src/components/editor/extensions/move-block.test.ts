// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterAll, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown, seedMarkdown } from '../tiptap-editor';

/*
 * Ctrl/⌘+Shift+↑/↓ moves the block the caret is in (the keyboard way to do what
 * the block handle's drag does), with the caret staying in the moved text and
 * one undo putting it back.
 */
const element = document.createElement('div');
document.body.append(element);
const editor = new Editor({ element, extensions: buildEditorExtensions() });
afterAll(() => editor.destroy());

/** Put the caret `offset` characters into the first text that reads `text`. */
function caretIn(text: string, offset = 1) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(text)) at = pos + (node.text?.indexOf(text) ?? 0) + offset;
  });
  if (at < 0) throw new Error(`No text "${text}"`);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
}
/** A real keydown through ProseMirror's keymaps; true when one handled it. */
function press(key: 'ArrowUp' | 'ArrowDown', init: KeyboardEventInit = { ctrlKey: true, shiftKey: true }) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  let handled = false;
  editor.view.someProp('handleKeyDown', (handler) => {
    handled = handler(editor.view, event) || handled;
    return handled;
  });
  return handled;
}
const caretText = () => editor.state.selection.$from.parent.textContent;
const saved = () => getMarkdown(editor).trim();

describe('moving a block with the keyboard', () => {
  it('moves a paragraph up and down past its neighbours, keeping the caret in it', () => {
    seedMarkdown(editor, 'First\n\nSecond\n\nThird');
    caretIn('Third', 2);
    expect(press('ArrowUp')).toBe(true);
    expect(saved()).toBe('First\n\nThird\n\nSecond');
    expect(caretText()).toBe('Third');
    expect(editor.state.selection.$from.parentOffset).toBe(2);
    expect(press('ArrowUp')).toBe(true);
    expect(saved()).toBe('Third\n\nFirst\n\nSecond');
    expect(press('ArrowDown')).toBe(true);
    expect(saved()).toBe('First\n\nThird\n\nSecond');
  });

  it('does nothing at the top or bottom, and still keeps the key from extending the selection', () => {
    seedMarkdown(editor, 'First\n\nSecond');
    caretIn('First');
    expect(press('ArrowUp')).toBe(true);
    expect(saved()).toBe('First\n\nSecond');
    caretIn('Second');
    expect(press('ArrowDown')).toBe(true);
    expect(saved()).toBe('First\n\nSecond');
  });

  it('moves a whole list item among its siblings, nested items included', () => {
    seedMarkdown(editor, '- One\n- Two\n  - Two point one\n- Three');
    caretIn('Two', 1);
    expect(press('ArrowDown')).toBe(true);
    expect(saved()).toBe('- One\n- Three\n- Two\n  - Two point one');
    expect(caretText()).toBe('Two');
  });

  it('moves a heading, and one undo puts it back', () => {
    seedMarkdown(editor, '## Setup\n\nText\n\n## Usage');
    caretIn('Usage');
    expect(press('ArrowUp')).toBe(true);
    expect(saved()).toBe('## Setup\n\n## Usage\n\nText');
    editor.commands.undo();
    expect(saved()).toBe('## Setup\n\nText\n\n## Usage');
  });

  it('moves a table as one block from any cell', () => {
    seedMarkdown(editor, 'Intro\n\n| A | B |\n| - | - |\n| 1 | 2 |');
    caretIn('2', 0);
    expect(press('ArrowUp')).toBe(true);
    expect(saved().startsWith('| A')).toBe(true);
    expect(saved().endsWith('Intro')).toBe(true);
  });

  it('never moves a later block of a list item above the item’s own text', () => {
    seedMarkdown(editor, '- Item\n\n  ```\n  code\n  ```\n- Next');
    const before = saved();
    caretIn('code', 1);
    expect(press('ArrowUp')).toBe(true);
    expect(saved()).toBe(before);
    expect(caretText()).toBe('code');
  });

  it('leaves a selection across blocks to the browser, which extends it', () => {
    seedMarkdown(editor, 'First\n\nSecond\n\nThird');
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Second') from = pos + 1;
      if (node.isText && node.text === 'Third') to = pos + 3;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, to)));
    expect(press('ArrowDown')).toBe(false);
    expect(press('ArrowUp')).toBe(false);
    expect(saved()).toBe('First\n\nSecond\n\nThird');
  });

  it('moves a selection inside one block with its block', () => {
    seedMarkdown(editor, 'First\n\nSecond');
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Second') from = pos + 1;
    });
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, from, from + 3)));
    expect(press('ArrowUp')).toBe(true);
    expect(saved()).toBe('Second\n\nFirst');
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe('eco');
  });

  it('leaves plain Shift+arrow selection alone', () => {
    seedMarkdown(editor, 'First\n\nSecond');
    caretIn('Second');
    expect(press('ArrowUp', { shiftKey: true })).toBe(false);
    expect(saved()).toBe('First\n\nSecond');
  });
});
