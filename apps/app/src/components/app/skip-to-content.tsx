import { useT } from '@nibleaf/i18n/react';

/**
 * Where "Skip to main content" lands, most specific first:
 * 1. `#main-content` — the dashboard and site layouts' content wrapper;
 * 2. `[data-main-content]` — a screen that renders without those layouts (the
 *    editor canvas, preview) marks its own content region;
 * 3. the page's `<main>` / `role="main"` landmark.
 * Hidden matches (e.g. a closed layout kept mounted) are skipped.
 */
const MAIN_CONTENT_SELECTORS = ['#main-content', '[data-main-content]', 'main', '[role="main"]'];

const isRendered = (element: HTMLElement) => !element.closest('[hidden], [inert], [aria-hidden="true"]');

export function findMainContent(root: ParentNode = document): HTMLElement | null {
  for (const selector of MAIN_CONTENT_SELECTORS) {
    const match = [...root.querySelectorAll<HTMLElement>(selector)].find(isRendered);
    if (match) return match;
  }
  return null;
}

/** Moves focus to the main content so keyboard and screen-reader users skip the sidebar and header. */
export function skipToMainContent(root: ParentNode = document): boolean {
  const target = findMainContent(root);
  if (!target) return false;
  // Make a non-interactive region focusable without adding it to the tab order.
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.focus();
  target.scrollIntoView?.({ block: 'start' });
  return true;
}

/** Keyboard users jump past the sidebar. The first focusable control on every signed-in screen. */
export function SkipToContent() {
  const t = useT();
  return (
    <button
      className="sr-only rounded-md bg-background px-3 py-2 font-medium text-sm shadow-md outline-none ring-3 ring-ring/50 focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100]"
      onClick={() => skipToMainContent()}
      type="button"
    >
      {t('nav.skipToContent')}
    </button>
  );
}
