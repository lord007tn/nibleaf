import type { Editor, JSONContent, Range } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection, type Transaction } from '@tiptap/pm/state';

/**
 * The block of `type` that the steps from `firstStep` on put into the document,
 * or null unless there is exactly one. Only what those steps wrote is searched
 * (their new ranges, mapped to the end of the transaction), so a block of the
 * same kind that was already there, around the insert point or next to it, is
 * never picked: TipTap can leave the caret outside the new block (text after
 * the slash query stays in the paragraph), so the caret can't be trusted.
 */
const insertedBlock = (tr: Transaction, firstStep: number, type: string): { node: PMNode; pos: number } | null => {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (let index = firstStep; index < tr.steps.length; index += 1) {
    const later = tr.mapping.slice(index + 1);
    tr.steps[index]?.getMap().forEach((_oldStart, _oldEnd, newStart, newEnd) => {
      from = Math.min(from, later.map(newStart, -1));
      to = Math.max(to, later.map(newEnd, 1));
    });
  }
  if (from >= to) return null;
  const found: { node: PMNode; pos: number }[] = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    if (node.type.name !== type || pos < from || pos + node.nodeSize > to) return true;
    found.push({ node, pos });
    return false;
  });
  return found.length === 1 ? (found[0] ?? null) : null;
};

/**
 * Puts the caret on the first text position of the new block's first item
 * (UX audit P2-ED-004); scaffold text there (a column's "Column 1") is
 * selected so typing replaces it. When the new block can't be identified for
 * certain, the selection stays where TipTap put it.
 */
const caretToFirstItem = (tr: Transaction, firstStep: number, type: string): void => {
  const block = insertedBlock(tr, firstStep, type);
  if (!block) return;
  let start = -1;
  let end = -1;
  block.node.descendants((node, offset) => {
    if (start >= 0) return false;
    if (!node.isTextblock) return true;
    start = block.pos + 1 + offset + 1;
    end = start + node.content.size;
    return false;
  });
  if (start >= 0) tr.setSelection(TextSelection.create(tr.doc, start, end));
};

/**
 * Replaces the slash query with a block made of several items (Tabs, Steps,
 * Columns…) and leaves the caret in its first item. One transaction, so a
 * single undo removes the whole block.
 */
export const insertBlockAtFirstItem = (editor: Editor, range: Range, block: JSONContent & { type: string }): boolean => {
  let firstStep = 0;
  return editor
    .chain()
    .focus()
    .deleteRange(range)
    .command(({ tr }) => {
      firstStep = tr.steps.length;
      return true;
    })
    .insertContent(block)
    .command(({ tr }) => {
      caretToFirstItem(tr, firstStep, block.type);
      return true;
    })
    .run();
};
