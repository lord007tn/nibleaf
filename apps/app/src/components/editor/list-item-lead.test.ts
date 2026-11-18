// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from './tiptap-editor';

const editors: Editor[] = [];
function open(source: string): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: buildEditorExtensions(),
    editorProps: { handleScrollToSelection: () => true },
  });
  editor.commands.setContent(source, { emitUpdate: false });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function shape(node: PMNode): unknown {
  if (node.type.name === 'paragraph' && node.content.size === 0) return null;
  if (node.isText) return node.text;
  const children: unknown[] = [];
  node.forEach((child) => {
    const value = shape(child);
    if (value !== null) children.push(value);
  });
  return { type: node.type.name, start: node.attrs.start, level: node.attrs.level, children };
}

/** Each list item's empty first paragraph, where the caret goes. */
function leads(editor: Editor): number[] {
  const positions: number[] = [];
  editor.state.doc.descendants((node, pos, parent) => {
    if (parent?.type.name === 'listItem' && parent.firstChild === node && node.type.name === 'paragraph' && !node.content.size)
      positions.push(pos + 1);
  });
  return positions;
}

function firstLead(editor: Editor): number {
  const [position] = leads(editor);
  if (position === undefined) throw new Error('No empty item paragraph');
  return position;
}

function typeIntoLead(editor: Editor): void {
  editor.view.dispatch(editor.state.tr.insertText('Typed', firstLead(editor)));
}

function enterInLead(editor: Editor): void {
  editor.commands.setTextSelection(firstLead(editor));
  editor.commands.keyboardShortcut('Enter');
}

/** The save reloads as the document it was written from, and saves the same again. */
function expectStable(editor: Editor, saved: string): void {
  expect(getMarkdown(editor)).toBe(saved);
  const reloaded = open(saved);
  expect(shape(reloaded.state.doc)).toEqual(shape(editor.state.doc));
  expect(getMarkdown(reloaded)).toBe(saved);
}

describe('review regressions of the list item lead (#604, #865)', () => {
  it.each([
    ['10)\n    > Alpha\n\nOutro.', '10. > Alpha\n\nOutro.'],
    ['10.\n    > Alpha\n\nOutro.', '10. > Alpha\n\nOutro.'],
    ['100.\n     > Alpha\n\nOutro.', '100. > Alpha\n\nOutro.'],
    ['10)\n    ## Heading\n\nOutro.', '10. ## Heading\n\nOutro.'],
    ['-\n  > Alpha\n\nOutro.', '- > Alpha\n\nOutro.'],
    ['-\n  ## Heading\n\nOutro.', '- ## Heading\n\nOutro.'],
  ])('a marker-only item keeps its block out of a code block: %j', (source, saved) => {
    const editor = open(source);
    expectStable(editor, saved);
    let code = false;
    open(saved).state.doc.descendants((node) => {
      code ||= node.type.name === 'codeBlock';
    });
    expect(code).toBe(false);
  });

  it.each([
    ['- > Alpha', '- \n- > Alpha'],
    ['- ## Heading', '- \n- ## Heading'],
    ['1. > Alpha', '1. \n2. > Alpha'],
    ['10) > Alpha', '10. \n11. > Alpha'],
  ])('Enter in the empty lead keeps the block in its item: %j', (source, saved) => {
    const editor = open(source);
    enterInLead(editor);
    expectStable(editor, saved);
  });

  it.each([
    ['- > Alpha\n- > Beta', '- Typed\n\n  > Alpha\n\n- > Beta'],
    ['- ## Alpha\n- ## Beta', '- Typed\n\n  ## Alpha\n\n- ## Beta'],
    ['1. > Alpha\n2. > Beta', '1. Typed\n\n   > Alpha\n\n2. > Beta'],
  ])('typing into a lead makes the list loose in one save: %j', (source, saved) => {
    const editor = open(source);
    typeIntoLead(editor);
    expectStable(editor, saved);
  });

  it.each([
    ['- 10) Child\n  11) Next\n- Sibling\n\nOutro.', '- Typed\n\n  10. Child\n  11. Next\n\n- Sibling\n\nOutro.'],
    ['- 3. Child\n- Sibling', '- Typed\n\n  3. Child\n\n- Sibling'],
  ])('text typed before a list that cannot interrupt it keeps the list: %j', (source, saved) => {
    const editor = open(source);
    typeIntoLead(editor);
    expectStable(editor, saved);
  });

  it('an ordered item before one with no lead keeps its block under the marker', () => {
    expectStable(open('1.\n   > Alpha\n2. Sibling'), '1. \n   > Alpha\n2. Sibling');
    expectStable(open('1.\n   > Alpha\n\n2. Sibling\n\nOutro.'), '1. \n   > Alpha\n\n2. Sibling\n\nOutro.');
    const editor = open('1. > Alpha\n2. > Beta');
    editor.view.dispatch(editor.state.tr.insertText('Typed', leads(editor)[1] as number));
    expectStable(editor, '1. \n   > Alpha\n\n2. Typed\n\n   > Beta');
  });

  it('a list numbered from 10 stays in the ordered item Backspace moved it to', () => {
    const editor = open('1. Top\n   - 10) Child\n     11) Next\n2. Next');
    editor.commands.setTextSelection(firstLead(editor));
    editor.commands.keyboardShortcut('Backspace');
    expectStable(editor, '1. Top\n2. \n   10. Child\n   11. Next\n3. Next');
  });

  it('a lead inside a quote survives when the quote leaves its item', () => {
    const saved = getMarkdown(open('1. > - # Deep\n2. Sibling'));
    expect(saved).toBe('1. \n\n> - # Deep\n\n- Sibling');
    expect(getMarkdown(open(saved))).toBe(saved);
  });

  it('text split out of a lead keeps the list loose before its quote', () => {
    const editor = open('- > Alpha\n- > Beta');
    const lead = firstLead(editor);
    typeIntoLead(editor);
    editor.commands.setTextSelection(lead + 2);
    editor.commands.keyboardShortcut('Enter');
    expectStable(editor, '- Ty\n\n- ped\n\n  > Alpha\n\n- > Beta');
  });

  it('an emptied nested marker never turns the text above it into a heading', () => {
    const editor = open('- Top\n  - > Alpha');
    enterInLead(editor);
    expectStable(editor, '- Top\n\n  - \n  - > Alpha');
  });

  it.each([
    ['- Text\n  ## Heading\n- Next', '- Text\n\n  ## Heading\n- Next'],
    ['- Text\n\n  3. Child\n- Next', '- Text\n\n  3. Child\n\n- Next'],
  ])('a list with no lead keeps the spacing main gives it: %j', (source, saved) => {
    expect(getMarkdown(open(source))).toBe(saved);
  });

  it('a nested list that can interrupt the typed text stays tight', () => {
    const editor = open('- - Child\n- Sibling');
    typeIntoLead(editor);
    expectStable(editor, '- Typed\n  - Child\n- Sibling');
  });
});
