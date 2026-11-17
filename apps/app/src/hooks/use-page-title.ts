import { useEffect } from 'react';

/** Whether a head mutation touched a `<title>`: its text, or the element itself. */
function touchesTitle(record: MutationRecord): boolean {
  const isTitle = (node: Node | null) => node?.nodeName === 'TITLE';
  if (isTitle(record.target) || isTitle(record.target.parentNode)) return true;
  return [...record.addedNodes, ...record.removedNodes].some(isTitle);
}

/**
 * Keep the browser tab's title on `title` while the calling component is
 * shown, and give the previous title back when it goes, so a page without a
 * title of its own never keeps another page's.
 *
 * It gives it back only if nothing else wrote the title meanwhile. A route
 * whose head set a title (a reader page) keeps it, even when that title is
 * the very same text as this one. That's why it watches for writes instead
 * of comparing strings.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    let overwritten = false;
    const observer =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver((records) => {
            if (records.some(touchesTitle)) overwritten = true;
          });
    observer?.observe(document.head, { characterData: true, childList: true, subtree: true });
    return () => {
      // Writes made in this same commit haven't reached the callback yet.
      if (observer?.takeRecords().some(touchesTitle)) overwritten = true;
      observer?.disconnect();
      if (!overwritten && document.title === title) document.title = previous;
    };
  }, [title]);
}
