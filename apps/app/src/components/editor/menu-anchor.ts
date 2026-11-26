import type { Editor } from '@tiptap/core';

/** How far every floating editor menu stays from the edges of the screen. */
export const MENU_EDGE_PADDING = 8;

/**
 * A floating menu's anchor: the block around the selection that matches
 * `selector` (a table, a code block), so the menu sits beside the block instead
 * of on the line being typed. Null outside such a block, which falls back to the
 * selection.
 */
export function blockAnchor(editor: Editor, selector: string) {
  return () => {
    if (editor.isDestroyed) return null;
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const element = (node instanceof Element ? node : node.parentElement)?.closest(selector);
    if (!element || !editor.view.dom.contains(element)) return null;
    return {
      getBoundingClientRect: () => element.getBoundingClientRect(),
      getClientRects: () => element.getClientRects(),
    };
  };
}
