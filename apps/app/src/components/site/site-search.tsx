import { type ComponentProps, lazy, Suspense, useEffect, useState } from 'react';

const loadSiteSearchDialog = () => import('./site-search-dialog');
const SiteSearchDialog = lazy(loadSiteSearchDialog);

/** Fetch the search dialog's code ahead of the first open (idle time, or when a
 * reader points at / focuses the search trigger). Without it, the first letters
 * typed right after ⌘K land while the code is still loading and are lost. */
export const preloadSiteSearch = (): void => {
  void loadSiteSearchDialog();
};

export function SiteSearch(props: ComponentProps<typeof SiteSearchDialog>) {
  const { open, onOpenChange, hotkey } = props;
  const [activated, setActivated] = useState(open);
  // Preserve the dialog's selected mode and query after its first opening.
  useEffect(() => {
    if (open) setActivated(true);
  }, [open]);

  useEffect(() => {
    // Warm the chunk once the page is idle so the first open is instant.
    const idle = window.requestIdleCallback ?? ((callback: () => void) => window.setTimeout(callback, 2000));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const handle = idle(() => preloadSiteSearch());
    return () => cancel(handle);
  }, []);

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
    };
    const onKey = (event: KeyboardEvent) => {
      if (hotkey === 'slash' && event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        preloadSiteSearch();
        onOpenChange(true);
        return;
      }
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        preloadSiteSearch();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange, hotkey]);

  return <Suspense fallback={null}>{open || activated ? <SiteSearchDialog {...props} /> : null}</Suspense>;
}
