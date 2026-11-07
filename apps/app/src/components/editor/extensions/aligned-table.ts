import type { Editor } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import type { MarkdownNodeSpec } from 'tiptap-markdown';

export type ColumnAlignment = 'left' | 'center' | 'right';
const alignAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) => {
    const align = element.style.textAlign || element.getAttribute('align');
    return align && /^(left|center|right)$/.test(align) ? align : null;
  },
  renderHTML: (attributes: Record<string, unknown>) => (attributes.align ? { style: `text-align: ${attributes.align}` } : {}),
};
export const AlignedTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), align: alignAttribute };
  },
});
export const AlignedTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), align: alignAttribute };
  },
});

/** Markdown aligns whole columns, so changing a selection updates every cell in those columns. */
export function alignTableColumns(editor: Editor, alignment: ColumnAlignment): boolean {
  const { selection, tr } = editor.state;
  let depth = selection.$from.depth;
  while (depth > 0 && selection.$from.node(depth).type.name !== 'table') depth--;
  if (!depth) return false;
  const table = selection.$from.node(depth);
  const start = selection.$from.start(depth);
  const map = TableMap.get(table);
  const rect =
    selection instanceof CellSelection
      ? map.rectBetween(selection.$anchorCell.pos - start, selection.$headCell.pos - start)
      : map.findCell(selection.$from.before(depth + 2) - start);
  const positions = new Set<number>();
  for (let row = 0; row < map.height; row++) {
    for (let col = rect.left; col < rect.right; col++) {
      const position = map.map[row * map.width + col];
      if (position !== undefined) positions.add(position);
    }
  }
  for (const position of positions) {
    const node = table.nodeAt(position);
    if (node) tr.setNodeMarkup(start + position, undefined, { ...node.attrs, align: alignment });
  }
  editor.view.dispatch(tr);
  return true;
}

function markdownTable(node: PMNode): boolean {
  let valid = node.childCount > 0;
  node.forEach((row, _offset, index) => {
    row.forEach((cell, _cellOffset, column) => {
      if (
        cell.attrs.colspan > 1 ||
        cell.attrs.rowspan > 1 ||
        cell.childCount !== 1 ||
        cell.firstChild?.type.name !== 'paragraph' ||
        (index === 0 ? cell.type.name !== 'tableHeader' : cell.type.name !== 'tableCell') ||
        (index > 0 && cell.attrs.align !== node.firstChild?.maybeChild(column)?.attrs.align)
      )
        valid = false;
    });
  });
  return valid;
}

export const AlignedTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          // Merged cells, headerless tables and rich cells need HTML to remain lossless.
          if (!markdownTable(node)) {
            const container = document.createElement('div');
            container.append(DOMSerializer.fromSchema(node.type.schema).serializeNode(node));
            state.write(container.innerHTML);
            state.closeBlock(node);
            return;
          }
          const tableState = state as typeof state & { inTable: boolean };
          tableState.inTable = true;
          node.forEach((row, _offset, index) => {
            state.write('| ');
            row.forEach((cell, _cellOffset, column) => {
              if (column) state.write(' | ');
              if (cell.firstChild) state.renderInline(cell.firstChild);
            });
            state.write(' |');
            state.ensureNewLine();
            if (index === 0) {
              const delimiters: string[] = [];
              row.forEach((cell) => {
                delimiters.push({ left: ':---', center: ':---:', right: '---:' }[cell.attrs.align as ColumnAlignment] ?? '---');
              });
              state.write(`| ${delimiters.join(' | ')} |`);
              state.ensureNewLine();
            }
          });
          tableState.inTable = false;
          state.closeBlock(node);
        },
        parse: {},
      } satisfies MarkdownNodeSpec,
    };
  },
});
