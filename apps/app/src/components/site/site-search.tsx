import { type ComponentProps, lazy, Suspense, useEffect, useState } from 'react';

const SiteSearchDialog = lazy(() => import('./site-search-dialog'));

export function SiteSearch(props: ComponentProps<typeof SiteSearchDialog>) {
  const { open, onOpenChange, hotkey } = props;
  const [activated, setActivated] = useState(open);
  // Preserve the dialog's selected mode and query after its first opening.
  useEffect(() => {
    if (open) setActivated(true);
  }, [open]);

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
        onOpenChange(true);
        return;
      }
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange, hotkey]);

  return <Suspense fallback={null}>{open || activated ? <SiteSearchDialog {...props} /> : null}</Suspense>;
}
