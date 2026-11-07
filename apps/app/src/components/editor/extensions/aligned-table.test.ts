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
  it.each(['addRowBefore', 'addRowAfter', 'addColumnAfter'] as const)('inherits column alignment on %s and keeps pipe syntax (A, 8)', (command) => {
    const editor = makeEditor(aligned);
    editor.commands.setTextSelection(4);
    editor.commands[command]();
    const saved = getMarkdown(editor);
    expect(saved).not.toContain('<table');
    expect(saved).toContain(command === 'addColumnAfter' ? '| :--- | :--- | :---: | ---: |' : '| :--- | :---: | ---: |');
    const header = editor.state.doc.firstChild?.firstChild;
    editor.state.doc.firstChild?.forEach((row) => {
      row.forEach((cell, _offset, column) => {
        expect(cell.attrs.align).toBe(header?.child(column).attrs.align);
      });
    });
    editor.commands.setContent(saved, { emitUpdate: false });
    expect(getMarkdown(editor)).toBe(saved);
  });
  it('reloads pipes in code, escaped prose, bold, link text and destinations semantically (B, 2)', () => {
    const source = '| Code | Text | Bold | Link |\n| --- | --- | --- | --- |\n| `a\\|b` | x \\| y | **a\\|b** | [a\\|b](https://example.com/a%7Cb) |';
    const editor = makeEditor(source);
    // Include a literal pipe in the link destination too, not just its encoded spelling.
    editor.state.doc.descendants((node, pos) => {
      const mark = node.marks.find((item) => item.type.name === 'link');
      if (mark)
        editor.view.dispatch(editor.state.tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, href: 'https://example.com/a|b' })));
    });
    const semantic = () => {
      const cells: { text: string; marks: { type: string; href?: string }[] }[] = [];
      editor.state.doc.descendants((cell) => {
        if (!['tableHeader', 'tableCell'].includes(cell.type.name)) return;
        const marks: { type: string; href?: string }[] = [];
        cell.descendants((child) => {
          for (const mark of child.marks)
            marks.push({ type: mark.type.name, ...(mark.type.name === 'link' ? { href: decodeURI(mark.attrs.href) } : {}) });
        });
        cells.push({ text: cell.textContent, marks });
      });
      return cells;
    };
    const before = semantic();
    const saved = getMarkdown(editor);
    expect(saved).toContain('`a\\|b`');
    editor.commands.setContent(saved, { emitUpdate: false });
    expect(semantic()).toEqual(before);
  });
  it('keeps a literal backslash right before a pipe, in text and in code, through save and reload', () => {
    const editor = makeEditor('| A | B |\n| --- | --- |\n| x | y |');
    const cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') cells.push(pos + 2);
    });
    const [first, second] = cells as [number, number];
    // Insert from the end so the first position stays valid.
    editor
      .chain()
      .setTextSelection(second)
      .insertContent({ type: 'text', text: 'c\\|d', marks: [{ type: 'code' }] })
      .run();
    editor.chain().setTextSelection(first).insertContent({ type: 'text', text: 'a\\|b' }).run();
    const text = () => {
      const values: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === 'tableCell') values.push(node.textContent);
      });
      return values;
    };
    expect(text()).toEqual(['a\\|bx', 'c\\|dy']);
    const saved = getMarkdown(editor);
    expect(saved).toContain('a\\\\\\|b');
    expect(saved).toContain('`c\\\\|d`');
    editor.commands.setContent(saved, { emitUpdate: false });
    expect(text()).toEqual(['a\\|bx', 'c\\|dy']);
    expect(getMarkdown(editor)).toBe(saved);
  });

  it('encodes blank lines in HTML fallback code cells and writes physical align attributes (C, 8)', () => {
    const editor = makeEditor('<table><tr><td align="right"><pre><code>first&#10;&#10;last</code></pre></td></tr></table>');
    const saved = getMarkdown(editor);
    expect(saved).toContain('align="right"');
    expect(saved).not.toContain('style=');
    expect(saved).toContain('first&#10;&#10;last');
    editor.commands.setContent(saved, { emitUpdate: false });
    expect(editor.state.doc.firstChild?.firstChild?.firstChild?.textContent).toBe('first\n\nlast');
  });
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
    expect(output).toContain('align="right"');
    editor.commands.setContent(output, { emitUpdate: false });
    expect(getMarkdown(editor)).toBe(output);
  });
});
