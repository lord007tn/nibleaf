/**
 * The element to return focus to when a dialog closes, read when it opens:
 * the focused element, or null when there is none worth returning to (no DOM
 * during server rendering, or focus resting on the body because nothing was
 * focused, e.g. a programmatic open or a Safari click on a button).
 */
export function currentFocusTarget(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

/**
 * Where focus should land when a dialog closes (operations/ui-overhaul.md
 * §5.5, §6.3): the element that had focus before it opened while it is still
 * on the page; otherwise (the trigger was the row that just got deleted, or
 * nothing had focus) the page's h1, made programmatically focusable if it
 * isn't already; else the body. Returns the element so it can be handed to a
 * dialog's `finalFocus`. Only called in the browser, on close.
 */
export function restoreFocusFallback(previous?: HTMLElement | null): HTMLElement {
  if (previous && previous !== document.body && previous.isConnected) return previous;
  const heading = document.querySelector('h1');
  if (heading instanceof HTMLElement) {
    if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
    return heading;
  }
  return document.body;
}
