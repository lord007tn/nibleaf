/**
 * Where focus should land when a dialog closes (operations/ui-overhaul.md
 * §5.5, §6.3): the element that had focus before it opened while it is still
 * on the page; otherwise (the trigger was the row that just got deleted) the
 * page's h1, made programmatically focusable if it isn't already; else the
 * body. Returns the element so it can be handed to a dialog's `finalFocus`.
 */
export function restoreFocusFallback(previous?: HTMLElement | null): HTMLElement {
  if (previous?.isConnected) return previous;
  const heading = document.querySelector('h1');
  if (heading instanceof HTMLElement) {
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    return heading;
  }
  return document.body;
}
