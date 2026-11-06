import { siteT } from '@nibleaf/i18n/site';
import { Search } from 'lucide-react';
import { type ComponentProps, lazy, Suspense, useEffect, useState } from 'react';

const loadSiteSearchDialog = () => import('./site-search-dialog');
const SiteSearchDialog = lazy(loadSiteSearchDialog);

/** Fetch the search dialog's code ahead of the first open (idle time, or when a
 * reader points at / focuses the search trigger). */
export const preloadSiteSearch = (): void => {
  void loadSiteSearchDialog();
};

/**
 * Stand-in shown only while the dialog's code is still downloading. It renders
 * the same input immediately and keeps whatever the reader types, which the
 * dialog then picks up, so the first letters after ⌘K are never lost.
 */
export function SearchShell({
  value,
  onChange,
  onClose,
  placeholder,
  label,
  rtl,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  placeholder: string;
  label: string;
  rtl: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50" data-search-shell="">
      <div className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" aria-hidden />
      <div
        dir={rtl ? 'rtl' : 'ltr'}
        className="absolute inset-0 flex flex-col bg-popover text-popover-foreground sm:inset-auto sm:start-1/2 sm:top-[12vh] sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-xl sm:shadow-2xl sm:ring-1 sm:ring-foreground/10 sm:rtl:translate-x-1/2"
      >
        <div className="flex h-14 items-center gap-1 border-border/70 border-b ps-4 pe-2 pt-[env(safe-area-inset-top)]">
          <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            aria-label={label}
            value={value}
            placeholder={placeholder}
            maxLength={300}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
            }}
            className="h-14 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground/80 sm:text-[15px]"
          />
        </div>
      </div>
    </div>
  );
}

export function SiteSearch(props: ComponentProps<typeof SiteSearchDialog>) {
  const { open, onOpenChange, hotkey, lang, direction, placeholder } = props;
  const [activated, setActivated] = useState(open);
  const [pendingQuery, setPendingQuery] = useState('');
  // Preserve the dialog's selected mode and query after its first opening.
  useEffect(() => {
    if (open) setActivated(true);
  }, [open]);

  useEffect(() => {
    // Warm the chunk once the page is idle so the first open is usually instant.
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

  const t = siteT(lang);
  const shell = open ? (
    <SearchShell
      value={pendingQuery}
      onChange={setPendingQuery}
      onClose={() => onOpenChange(false)}
      placeholder={placeholder?.trim() || t('searchPlaceholder')}
      label={t('searchDocumentation')}
      rtl={direction === 'rtl'}
    />
  ) : null;

  return <Suspense fallback={shell}>{open || activated ? <SiteSearchDialog {...props} initialQuery={pendingQuery} /> : null}</Suspense>;
}
