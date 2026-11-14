import type { CommandProps, Editor, JSONContent, Range } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

/**
 * Moves the caret into the first item of the `type` block that holds it: the
 * first text position of that item (UX audit P2-ED-004).
 *
 * Inserting a block leaves the caret at the end of what was inserted, which for
 * Tabs, Steps, Columns and the like is the LAST item, so the first thing typed
 * landed in the wrong one. The caret is inside the new block at this point, so
 * the nearest `type` ancestor is the block just inserted, even inside another
 * block of the same kind. Scaffold text in that first item (a column's
 * "Column 1") is selected, so typing replaces it.
 */
const caretToFirstItem =
  (type: string) =>
  ({ tr }: CommandProps): boolean => {
    const { $from } = tr.selection;
    for (let depth = $from.depth; depth > 0; depth -= 1) {
      const block = $from.node(depth);
      if (block.type.name !== type) continue;
      const blockStart = $from.start(depth);
      let start = -1;
      let end = -1;
      block.descendants((node, offset) => {
        if (start >= 0) return false;
        if (!node.isTextblock) return true;
        start = blockStart + offset + 1;
        end = start + node.content.size;
        return false;
      });
      if (start >= 0) tr.setSelection(TextSelection.create(tr.doc, start, end));
      break;
    }
    return true;
  };

/**
 * Replaces the slash query with a block made of several items (Tabs, Steps,
 * Columns…) and leaves the caret in its first item. One transaction, so a
 * single undo removes the whole block.
 */
export const insertBlockAtFirstItem = (editor: Editor, range: Range, block: JSONContent & { type: string }): boolean =>
  editor.chain().focus().deleteRange(range).insertContent(block).command(caretToFirstItem(block.type)).run();
