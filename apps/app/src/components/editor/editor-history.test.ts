// @vitest-environment jsdom
/** #630: a seed leaves no undo history, so undo never goes back past it. */
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, useLocale: () => ({ locale: 'en', t: (key: string) => key }) }));

import { buildEditorExtensions, getMarkdown, seedMarkdown } from './tiptap-editor';

const PAGE_A = 'Page A, the copy loaded first, with a paragraph\nwrapped over two lines.\n\n<Note>\n\nA note on page A.\n\n</Note>\n';
const PAGE_B = 'Page B, the fresher copy of the same page, with a paragraph\nwrapped over two lines.\n\n<Note>\n\nA note on page B.\n\n</Note>\n';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
function create() {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions() });
  editors.push(editor);
  return editor;
}
/** Type `text` at the end of the first paragraph, as keystrokes do. */
const type = (editor: Editor, text: string) =>
  editor.view.dispatch(editor.state.tr.insertText(text, editor.state.doc.firstChild?.nodeSize ?? 1).scrollIntoView());

describe('seedMarkdown leaves no undo history', () => {
  it('after a seed there is nothing to undo or redo', () => {
    const editor = create();
    seedMarkdown(editor, PAGE_A);
    expect(editor.can().undo()).toBe(false);
    expect(editor.can().redo()).toBe(false);
  });

  it('a re-seed drops the edits and undo history from before it', () => {
    const editor = create();
    seedMarkdown(editor, PAGE_A);
    type(editor, ' typed on A');
    editor.commands.undo();
    // An undone edit is a redo; the re-seed drops that too.
    expect(editor.can().redo()).toBe(true);
    type(editor, ' typed on A again');
    expect(editor.can().undo()).toBe(true);
    seedMarkdown(editor, PAGE_B);
    expect(editor.can().undo()).toBe(false);
    expect(editor.can().redo()).toBe(false);
    expect(getMarkdown(editor)).toBe(PAGE_B.trimEnd());
  });

  it('re-seed A → B, type, undo ×10: back to B, never A, and no update past B', () => {
    const editor = create();
    seedMarkdown(editor, PAGE_A);
    seedMarkdown(editor, PAGE_B);
    const updates: string[] = [];
    editor.on('update', () => updates.push(getMarkdown(editor)));
    type(editor, 'y');
    for (let index = 0; index < 10; index += 1) editor.commands.undo();
    expect(getMarkdown(editor)).toBe(PAGE_B.trimEnd());
    // The keystroke and its undo; nothing reaches A.
    expect(updates).toHaveLength(2);
    expect(updates.join('\n')).not.toContain('Page A');
  });

  it('a seed is not an update, and leaves the document as seeded', () => {
    const editor = create();
    const updates = vi.fn();
    editor.on('update', updates);
    seedMarkdown(editor, PAGE_A);
    seedMarkdown(editor, PAGE_B);
    expect(updates).not.toHaveBeenCalled();
    expect(getMarkdown(editor)).toBe(PAGE_B.trimEnd());
  });
});
