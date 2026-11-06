// @vitest-environment jsdom
/**
 * Editor behaviours that walk the document: per-block text direction (kept up to
 * date incrementally, never by re-reading the whole article on each keystroke)
 * and removing a callout as a whole.
 */
import { Editor, type JSONContent } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { isCalloutMenuHidden, keepCalloutMenu } from './extensions/callout';
import { blockDirection, blockDirectionDecorations, buildEditorExtensions, updateBlockDirections } from './tiptap-editor';

const editors: Editor[] = [];
const makeEditor = (dir: 'ltr' | 'rtl' = 'ltr') => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ dir }) });
  editors.push(editor);
  return editor;
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

const DIRECTION_BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem']);

/** What a full recomputation would give, in document (= DOM) order. */
const expectedDirections = (doc: PMNode, fallback: 'ltr' | 'rtl') => {
  const directions: string[] = [];
  doc.descendants((node) => {
    if (DIRECTION_BLOCKS.has(node.type.name)) directions.push(blockDirection(node.textContent, fallback));
  });
  return directions;
};
const renderedDirections = (editor: Editor) =>
  [...editor.view.dom.querySelectorAll('[data-auto-direction]')].map((element) => element.getAttribute('dir'));

describe('automatic block direction', () => {
  it('stays identical to a full recomputation through typing, splitting, joining and wrapping', () => {
    const editor = makeEditor('rtl');
    editor.commands.setContent('<p>Install the app</p><p>مرحبا بكم</p><ul><li><p>step one</p></li><li><p>الخطوة الثانية</p></li></ul><p></p>');
    expect(renderedDirections(editor)).toEqual(expectedDirections(editor.state.doc, 'rtl'));

    // Arabic typed at the start of an English paragraph flips just that block.
    editor.commands.insertContentAt(1, 'مقدمة ');
    expect(renderedDirections(editor)[0]).toBe('rtl');
    expect(renderedDirections(editor)).toEqual(expectedDirections(editor.state.doc, 'rtl'));

    // Split the Arabic paragraph, then join it back.
    const arabicStart = editor.state.doc.child(0).nodeSize + 1;
    editor.commands.setTextSelection(arabicStart + 3);
    editor.commands.splitBlock();
    expect(renderedDirections(editor)).toEqual(expectedDirections(editor.state.doc, 'rtl'));
    editor.commands.joinBackward();
    expect(renderedDirections(editor)).toEqual(expectedDirections(editor.state.doc, 'rtl'));

    // An English word at the start of the first list item turns the whole list LTR.
    let listItemText = 0;
    editor.state.doc.descendants((node, pos) => {
      if (!listItemText && node.type.name === 'listItem') listItemText = pos + 2;
    });
    editor.commands.insertContentAt(listItemText, 'Hello ');
    expect(renderedDirections(editor)).toEqual(expectedDirections(editor.state.doc, 'rtl'));

    // Wrap the last (empty) paragraph in a quote; delete everything.
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.setBlockquote();
    expect(renderedDirections(editor)).toEqual(expectedDirections(editor.state.doc, 'rtl'));
    editor.commands.clearContent();
    expect(renderedDirections(editor)).toEqual(expectedDirections(editor.state.doc, 'rtl'));
  });

  it('reuses the decorations when only the selection moves', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>Hello</p><p>مرحبا</p>');
    const decorations = blockDirectionDecorations(editor.state.doc, 'ltr');
    const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3));
    expect(updateBlockDirections(decorations, tr, 'ltr')).toBe(decorations);
  });
});

describe('remove callout', () => {
  const callout = (content: JSONContent[]): JSONContent => ({ type: 'doc', content: [{ type: 'callout', attrs: { variant: 'warning' }, content }] });
  const paragraph = (text: string): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text }] });

  it('keeps every paragraph together when the caret is in the middle one', () => {
    const editor = makeEditor();
    editor.commands.setContent(callout([paragraph('One'), paragraph('Two'), paragraph('Three')]));
    // doc > callout(0) > p "One" [1, 6) > p "Two" starts at 6, its text at 7.
    editor.commands.setTextSelection(8);
    expect(editor.commands.unsetCallout()).toBe(true);
    const doc = editor.state.doc;
    // (The editor always keeps an empty paragraph at the end of the page.)
    expect(doc.childCount).toBe(4);
    expect(doc.lastChild?.content.size).toBe(0);
    expect([0, 1, 2].map((index) => [doc.child(index).type.name, doc.child(index).textContent])).toEqual([
      ['paragraph', 'One'],
      ['paragraph', 'Two'],
      ['paragraph', 'Three'],
    ]);
    // The caret stays in the paragraph it was in.
    expect(editor.state.selection.$from.parent.textContent).toBe('Two');
  });

  it('keeps a list inside the callout as a list', () => {
    const editor = makeEditor();
    editor.commands.setContent(
      callout([
        paragraph('Before'),
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [paragraph('a')] },
            { type: 'listItem', content: [paragraph('b')] },
          ],
        },
      ]),
    );
    let inList = 0;
    editor.state.doc.descendants((node, pos) => {
      if (!inList && node.isText && node.text === 'b') inList = pos;
    });
    editor.commands.setTextSelection(inList);
    expect(editor.commands.unsetCallout()).toBe(true);
    const doc = editor.state.doc;
    expect([doc.child(0).type.name, doc.child(1).type.name]).toEqual(['paragraph', 'bulletList']);
    expect(doc.child(1).childCount).toBe(2);
  });

  it('does nothing outside a callout', () => {
    const editor = makeEditor();
    editor.commands.setContent('<p>Plain</p>');
    editor.commands.setTextSelection(2);
    expect(editor.commands.unsetCallout()).toBe(false);
  });
});

describe('callout type menu', () => {
  it('hides while typing in the callout and comes back when the caret enters a callout again', () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
        { type: 'callout', attrs: { variant: 'note' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note' }] }] },
      ],
    });
    // Intro paragraph [0, 7); callout starts at 7, its text at 9.
    editor.commands.setTextSelection(2);
    editor.commands.setTextSelection(10);
    expect(isCalloutMenuHidden(editor.state)).toBe(false);
    editor.commands.insertContent('s');
    expect(isCalloutMenuHidden(editor.state)).toBe(true);
    editor.commands.setTextSelection(11);
    expect(isCalloutMenuHidden(editor.state)).toBe(true);
    editor.commands.setTextSelection(2);
    editor.commands.setTextSelection(10);
    expect(isCalloutMenuHidden(editor.state)).toBe(false);
  });

  it('stays open while the writer switches the callout type', () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'callout', attrs: { variant: 'note' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note' }] }] }],
    });
    editor.commands.setTextSelection(3);
    editor.commands.insertContent('s');
    expect(isCalloutMenuHidden(editor.state)).toBe(true);
    editor
      .chain()
      .updateAttributes('callout', { variant: 'warning' })
      .command(({ tr }) => {
        keepCalloutMenu(tr);
        return true;
      })
      .run();
    expect(editor.state.doc.firstChild?.attrs.variant).toBe('warning');
    expect(isCalloutMenuHidden(editor.state)).toBe(false);
  });
});
