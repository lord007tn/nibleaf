import type { Editor } from '@tiptap/core';
import { createContext, useContext } from 'react';

/** How far every floating editor menu stays from the edges of the screen. */
export const MENU_EDGE_PADDING = 8;

/** The nearest ancestor that scrolls vertically: the page's own scroll box, or none (the window scrolls). */
export function scrollParent(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/** The box that clips what the writer sees of `element`. */
function scrollBox(element: Element): DOMRect {
  return scrollParent(element)?.getBoundingClientRect() ?? new DOMRect(0, 0, window.innerWidth, window.innerHeight);
}

/**
 * What the editor's floating menus follow as the page scrolls: the page's scroll
 * box (`scrollTarget` in their options). BubbleMenu listens to the window only by
 * default, and the editor scrolls inside its own box, so the menus stayed put
 * while the text moved under them (#963).
 */
export const MenuScrollTargetContext = createContext<HTMLElement | undefined>(undefined);
export const useMenuScrollTarget = () => useContext(MenuScrollTargetContext);

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
