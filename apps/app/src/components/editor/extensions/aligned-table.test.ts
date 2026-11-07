// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { alignTableColumns } from './aligned-table';

const editors: Editor[] = [];
const makeEditor = (markdown: string, dir: 'ltr' | 'rtl' = 'ltr') => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildEditorExtensions({ dir }) });
  editors.push(editor);
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor;
};
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});
const aligned = '| Name | Count | Status |\n| :--- | :---: | ---: |\n| Ada | 42 | Ready |';

describe('table column alignment', () => {
  it('keeps existing alignment after editing elsewhere and reloading', () => {
    const editor = makeEditor(`${aligned}\n\nAfter.`);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' Updated.');
    const output = getMarkdown(editor);
    expect(output).toContain('| :--- | :---: | ---: |');
    expect(output).toContain('After. Updated.');
    const json = editor.getJSON();
    editor.commands.setContent(output, { emitUpdate: false });
    expect(editor.getJSON()).toEqual(json);
    expect(getMarkdown(editor)).toBe(output);
  });
  it.each(['ltr', 'rtl'] as const)('updates the entire selected column in %s', (dir) => {
    const editor = makeEditor(aligned, dir);
    editor.commands.setTextSelection(4);
    expect(alignTableColumns(editor, dir === 'rtl' ? 'right' : 'left')).toBe(true);
    const cells: string[] = [];
    editor.state.doc.firstChild?.forEach((row) => {
      cells.push(row.firstChild?.attrs.align);
    });
    expect(cells).toEqual(dir === 'rtl' ? ['right', 'right'] : ['left', 'left']);
    expect(getMarkdown(editor)).toContain(dir === 'rtl' ? '| ---: | :---: | ---: |' : '| :--- | :---: | ---: |');
  });
  it('aligns all columns in a multi-cell selection', () => {
    const editor = makeEditor(aligned);
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (['tableHeader', 'tableCell'].includes(node.type.name)) cells.push(pos);
    });
    const [first, , , , last] = cells;
    if (first === undefined || last === undefined) throw new Error('Expected a two-row, three-column table');
    editor.view.dispatch(editor.state.tr.setSelection(CellSelection.create(editor.state.doc, first, last)));
    expect(alignTableColumns(editor, 'center')).toBe(true);
    expect(getMarkdown(editor)).toContain('| :---: | :---: | ---: |');
  });
  it('uses HTML for headerless and merged cells so content and alignment survive', () => {
    const editor = makeEditor('<table><tr><td colspan="2" style="text-align: right"><p>Wide cell</p></td></tr><tr><td>A</td><td>B</td></tr></table>');
    const output = getMarkdown(editor);
    expect(output).toContain('colspan="2"');
    expect(output).toContain('text-align: right');
    editor.commands.setContent(output, { emitUpdate: false });
    expect(getMarkdown(editor)).toBe(output);
  });
});
