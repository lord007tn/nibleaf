import type { Editor } from '@tiptap/core';

/** How far every floating editor menu stays from the edges of the screen. */
export const MENU_EDGE_PADDING = 8;

/** The nearest ancestor that scrolls vertically, whose box clips what the writer sees. */
function scrollBox(element: Element): DOMRect {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node.getBoundingClientRect();
  }
  return new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/**
 * A floating menu's anchor: the block around the selection (the first of
 * `selectors` that matches, nearest first: a table's scroll box, a code block),
 * so the menu sits beside the block instead of on the line being typed.
 *
 * Only the part of the block the writer can see counts: on a table or code
 * block taller than the screen, the menu stays at the visible edge rather than
 * at a top or bottom scrolled out of view. Null outside such a block, or when
 * none of it is visible, which falls back to the selection.
 */
export function blockAnchor(editor: Editor, ...selectors: string[]) {
  return () => {
    if (editor.isDestroyed) return null;
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const start = node instanceof Element ? node : node.parentElement;
    let element: Element | null = null;
    for (const selector of selectors) {
      element = start?.closest(selector) ?? null;
      if (element) break;
    }
    if (!element || !editor.view.dom.contains(element)) return null;
    const block = element;
    const visible = () => {
      const rect = block.getBoundingClientRect();
      const clip = scrollBox(block);
      const top = Math.max(rect.top, clip.top, 0);
      const bottom = Math.min(rect.bottom, clip.bottom, window.innerHeight);
      return bottom > top ? new DOMRect(rect.left, top, rect.width, bottom - top) : null;
    };
    if (!visible()) return null;
    return {
      getBoundingClientRect: () => visible() ?? block.getBoundingClientRect(),
      getClientRects: () => [visible() ?? block.getBoundingClientRect()],
    };
  };
}
