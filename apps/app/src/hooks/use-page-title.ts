import { useEffect } from 'react';

/** Keep the browser tab's title on `title` while the calling component is shown. */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
