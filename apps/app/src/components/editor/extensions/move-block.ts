import { Extension } from '@tiptap/core';
import { Fragment } from '@tiptap/pm/model';
import { type EditorState, NodeSelection, Selection, TextSelection, type Transaction } from '@tiptap/pm/state';

/** Blocks whose first paragraph moves the whole item, as in Notion. */
const ITEM_TYPES = new Set(['listItem', 'taskItem']);

/** The block that moves: its parent's depth and its index there. */
function movingBlock(state: EditorState): { parentDepth: number; index: number } | null {
  const { selection } = state;
  const { $from } = selection;
  if (selection instanceof NodeSelection) return { parentDepth: $from.depth, index: $from.index() };
  if ($from.depth < 1) return null;
  // Anywhere in a table, the table moves (never a paragraph inside a cell).
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') return { parentDepth: depth - 1, index: $from.index(depth - 1) };
  }
  let depth = $from.depth;
  if (depth >= 2 && ITEM_TYPES.has($from.node(depth - 1).type.name) && $from.index(depth - 1) === 0) depth -= 1;
  return { parentDepth: depth - 1, index: $from.index(depth - 1) };
}

/**
 * Swap the block holding the selection with the one before or after it, keeping
 * the selection where it was in the moved text. Null when there is nothing to
 * move or it is already first or last.
 */
function moveBlockTransaction(state: EditorState, direction: 'up' | 'down'): Transaction | null {
  const block = movingBlock(state);
  if (!block) return null;
  const { $from } = state.selection;
  const parent = $from.node(block.parentDepth);
  const sibling = direction === 'up' ? block.index - 1 : block.index + 1;
  if (sibling < 0 || sibling >= parent.childCount) return null;
  const first = Math.min(block.index, sibling);
  let start = $from.start(block.parentDepth);
  for (let index = 0; index < first; index += 1) start += parent.child(index).nodeSize;
  const a = parent.child(first);
  const b = parent.child(first + 1);
  const tr = state.tr.replaceWith(start, start + a.nodeSize + b.nodeSize, Fragment.from([b, a]));
  // The moved block shifted by its neighbour's size.
  const shift = direction === 'up' ? -parent.child(sibling).nodeSize : parent.child(sibling).nodeSize;
  const { selection } = state;
  const moved =
    selection instanceof NodeSelection
      ? NodeSelection.create(tr.doc, selection.from + shift)
      : selection instanceof TextSelection
        ? TextSelection.create(tr.doc, selection.anchor + shift, selection.head + shift)
        : Selection.near(tr.doc.resolve(selection.from + shift));
  return tr.setSelection(moved).scrollIntoView();
}

/**
 * Ctrl/⌘+Shift+↑/↓ moves the block the caret is in, the keyboard way to do what
 * the block handle's drag does (Notion's binding). At the top or bottom the key
 * does nothing, rather than extending the selection.
 */
export const MoveBlock = Extension.create({
  name: 'moveBlock',
  addKeyboardShortcuts() {
    const move = (direction: 'up' | 'down') => () => {
      const { editor } = this;
      if (!editor.isEditable || editor.view.composing) return false;
      const tr = moveBlockTransaction(editor.state, direction);
      if (tr) editor.view.dispatch(tr);
      return true;
    };
    return { 'Mod-Shift-ArrowUp': move('up'), 'Mod-Shift-ArrowDown': move('down') };
  },
});
