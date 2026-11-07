import type { Editor } from '@tiptap/core';
import { Table } from '@tiptap/extension-table';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import { DOMSerializer, type Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { ReplaceAroundStep, ReplaceStep } from '@tiptap/pm/transform';
import type { MarkdownNodeSpec } from 'tiptap-markdown';

export type ColumnAlignment = 'left' | 'center' | 'right' | null;
const alignAttribute = {
  default: null,
  parseHTML: (element: HTMLElement) => {
    const align = element.style.textAlign || element.getAttribute('align');
    return align && /^(left|center|right)$/.test(align) ? align : null;
  },
  renderHTML: (attributes: Record<string, unknown>) => (/^(left|center|right)$/.test(String(attributes.align)) ? { align: attributes.align } : {}),
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
    row.forEach((cell) => {
      if (
        cell.attrs.colspan > 1 ||
        cell.attrs.rowspan > 1 ||
        cell.childCount !== 1 ||
        cell.firstChild?.type.name !== 'paragraph' ||
        (index === 0 ? cell.type.name !== 'tableHeader' : cell.type.name !== 'tableCell')
      )
        valid = false;
    });
  });
  return valid;
}

export const AlignedTable = Table.extend({
  addProseMirrorPlugins() {
    const key = new PluginKey('column-alignment');
    return [
      ...(this.parent?.() ?? []),
      new Plugin({
        key,
        appendTransaction(transactions, oldState, state) {
          if (!transactions.some((tr) => tr.docChanged) || transactions.some((tr) => tr.getMeta('preventUpdate') || tr.getMeta(key))) return null;
          let newCells = false;
          for (const transaction of transactions)
            for (const step of transaction.steps) {
              if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) continue;
              step.slice.content.descendants((node) => {
                if (['tableCell', 'tableHeader'].includes(node.type.name)) newCells = true;
              });
            }
          // Typing elsewhere must not scan the article to maintain table columns.
          if (!newCells) return null;
          const oldTables = new Map<number, PMNode>();
          oldState.doc.descendants((node, pos) => {
            if (node.type.name !== 'table') return;
            let mapped = pos;
            for (const transaction of transactions) mapped = transaction.mapping.map(mapped);
            oldTables.set(mapped, node);
          });
          const tr = state.tr;
          state.doc.descendants((table, pos) => {
            if (table.type.name !== 'table') return;
            const old = oldTables.get(pos);
            if (!old || (old.childCount === table.childCount && TableMap.get(old).width === TableMap.get(table).width)) return;
            const first = table.firstChild;
            const oldHeaderMoved = old.firstChild && table.content.content.indexOf(old.firstChild) > 0;
            if (
              !first ||
              !(oldHeaderMoved ? old.firstChild : first)?.content.content.every(
                (cell) => cell.type.name === 'tableHeader' && cell.attrs.colspan === 1,
              )
            )
              return;
            const header = oldHeaderMoved ? old.firstChild : first;
            const alignments =
              header?.content.content.map((cell, column) => {
                if (!oldHeaderMoved && first.childCount > (old.firstChild?.childCount ?? 0) && !old.firstChild?.content.content.includes(cell))
                  return first.maybeChild(column - 1)?.attrs.align ?? first.maybeChild(column + 1)?.attrs.align ?? null;
                return cell.attrs.align ?? null;
              }) ?? [];
            table.forEach((row, rowOffset, index) => {
              row.forEach((cell, cellOffset, column) => {
                const align = alignments[column] ?? null;
                const type = oldHeaderMoved ? state.schema.nodes[index === 0 ? 'tableHeader' : 'tableCell'] : cell.type;
                if (cell.attrs.align !== align || cell.type !== type)
                  tr.setNodeMarkup(pos + 2 + rowOffset + cellOffset, type, { ...cell.attrs, align });
              });
            });
          });
          return tr.docChanged ? tr.setMeta(key, true) : null;
        },
      }),
    ];
  },
  addStorage() {
    return {
      markdown: {
        serialize(state, node) {
          // Merged cells, headerless tables and rich cells need HTML to remain lossless.
          if (!markdownTable(node)) {
            const container = document.createElement('div');
            container.append(DOMSerializer.fromSchema(node.type.schema).serializeNode(node));
            for (const element of container.querySelectorAll('[style]')) element.removeAttribute('style');
            for (const element of container.querySelectorAll('colgroup')) element.remove();
            // Literal blank lines would terminate a CommonMark HTML block.
            state.write(container.innerHTML.replace(/\n/g, '&#10;'));
            state.closeBlock(node);
            return;
          }
          const tableState = state as typeof state & { inTable: boolean; out: string };
          tableState.inTable = true;
          node.forEach((row, _offset, index) => {
            state.write('| ');
            row.forEach((cell, _cellOffset, column) => {
              if (column) state.write(' | ');
              if (cell.firstChild) {
                const start = tableState.out.length;
                state.renderInline(cell.firstChild);
                tableState.out = tableState.out.slice(0, start) + tableState.out.slice(start).replace(/\|/g, '\\|');
              }
            });
            state.write(' |');
            state.ensureNewLine();
            if (index === 0) {
              const delimiters: string[] = [];
              row.forEach((cell) => {
                delimiters.push({ left: ':---', center: ':---:', right: '---:' }[cell.attrs.align as 'left' | 'center' | 'right'] ?? '---');
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
