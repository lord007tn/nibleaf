import { useEffect } from 'react';

/**
 * Keep the browser tab's title on `title` while the calling component is
 * shown, and give the previous title back when it goes, so a page without a
 * title of its own never keeps another page's.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
