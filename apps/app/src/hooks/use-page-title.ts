import { useEffect } from 'react';

/**
 * Keep the browser tab's title on `title` while the calling component is
 * shown, and give the previous title back when it goes, so a page without a
 * title of its own never keeps another page's. It gives it back only if the
 * title is still its own: a route whose head set a title meanwhile (a reader
 * page) keeps it.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      if (document.title === title) document.title = previous;
    };
  }, [title]);
}
