// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterAll, describe, expect, it } from 'vitest';
import { blockAnchor } from './menu-anchor';
import { buildEditorExtensions, seedMarkdown } from './tiptap-editor';

/*
 * The table and code block menus sit beside their block, not on the line being
 * typed: their anchor is the block around the caret, and outside one there is
 * none (the menu then follows the selection, as before).
 */
const element = document.createElement('div');
document.body.append(element);
const editor = new Editor({ element, extensions: buildEditorExtensions() });
afterAll(() => editor.destroy());

function caretIn(text: string) {
  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text?.includes(text)) at = pos + (node.text?.indexOf(text) ?? 0) + 1;
  });
  if (at < 0) throw new Error(`No text "${text}"`);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, at)));
}

describe('the anchor of a block menu', () => {
  it('is the table around the caret, from any cell', () => {
    seedMarkdown(editor, 'Intro\n\n| Plan | Price |\n| - | - |\n| Free | 0 |');
    const table = editor.view.dom.querySelector('table');
    if (!table) throw new Error('No table');
    table.getBoundingClientRect = () => new DOMRect(10, 200, 600, 120);
    caretIn('Free');
    expect(blockAnchor(editor, 'table')()?.getBoundingClientRect()).toEqual(new DOMRect(10, 200, 600, 120));
    caretIn('Price');
    expect(blockAnchor(editor, 'table')()?.getBoundingClientRect().top).toBe(200);
  });

  it('is the code block around the caret', () => {
    seedMarkdown(editor, 'Intro\n\n```bash\nnpm install -g acme\n```');
    const pre = editor.view.dom.querySelector('pre');
    if (!pre) throw new Error('No code block');
    pre.getBoundingClientRect = () => new DOMRect(10, 300, 600, 60);
    caretIn('install');
    expect(blockAnchor(editor, 'pre')()?.getBoundingClientRect().top).toBe(300);
  });

  it('is none outside such a block, so the menu follows the selection', () => {
    seedMarkdown(editor, 'Intro\n\n| Plan | Price |\n| - | - |\n| Free | 0 |');
    caretIn('Intro');
    expect(blockAnchor(editor, 'table')()).toBeNull();
  });
});
