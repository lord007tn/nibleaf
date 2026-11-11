import { siteT } from '@nibleaf/i18n/site';
import { Search } from 'lucide-react';
import { type ComponentProps, type KeyboardEvent, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { isShortcutKey } from '@/lib/site-keyboard';
import { resolveReaderDirection } from '@/lib/text-direction';

const loadSiteSearchDialog = () => import('./site-search-dialog');
const SiteSearchDialog = lazy(loadSiteSearchDialog);

/** Fetch the search dialog's code ahead of the first open, when a reader points
 * at, touches or focuses a search trigger, or presses the shortcut. It stays
 * off the first load (about 50 KiB gzip with its command menu and select);
 * `SearchShell` keeps what the reader types while it downloads. */
export const preloadSiteSearch = (): void => {
  void loadSiteSearchDialog();
};

/** Keep Tab inside the shell: it is modal until the real dialog replaces it. */
const containFocus = (event: KeyboardEvent<HTMLDivElement>) => {
  if (event.key !== 'Tab') return;
  const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('input, button')].filter((element) => element.getClientRects().length > 0);
  const first = focusable[0];
  const last = focusable.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
};

/**
 * Stand-in shown only while the dialog's code is still downloading. It is a
 * small modal of its own (named, Esc / Cancel / outside tap to close, focus kept
 * inside) that keeps whatever the reader types, which the dialog then picks up,
 * so the first letters after ⌘K are never lost.
 */
export function SearchShell({
  value,
  onChange,
  onClose,
  placeholder,
  label,
  cancelLabel,
  rtl,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  placeholder: string;
  label: string;
  cancelLabel: string;
  rtl: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50" data-search-shell="">
      {/* Tap outside closes; Esc and Cancel close it from the keyboard. */}
      <div className="absolute inset-0 bg-black/10 supports-backdrop-filter:backdrop-blur-xs" aria-hidden onClick={onClose} />
      {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: a modal dialog handles Esc and keeps Tab inside itself. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        dir={rtl ? 'rtl' : 'ltr'}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          containFocus(event);
        }}
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
            className="h-14 min-w-0 flex-1 bg-transparent px-2 text-base outline-none placeholder:text-muted-foreground/80 sm:text-[15px]"
          />
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 shrink-0 cursor-pointer items-center rounded-md px-3 font-medium text-primary text-sm focus-visible:outline-2 focus-visible:outline-ring sm:hidden pointer-coarse:inline-flex!"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SiteSearch(props: Omit<ComponentProps<typeof SiteSearchDialog>, 'initialQuery' | 'returnFocus'>) {
  const { open, onOpenChange, hotkey, lang, direction, placeholder } = props;
  const [activated, setActivated] = useState(open);
  const [pendingQuery, setPendingQuery] = useState('');
  // Where focus returns when search closes: the last element focused outside it.
  const returnFocus = useRef<HTMLElement | null>(null);
  // Preserve the dialog's selected mode and query after its first opening.
  useEffect(() => {
    if (open) setActivated(true);
  }, [open]);

  useEffect(() => {
    if (open) return;
    const remember = (event: FocusEvent) => {
      const target = event.target;
      // Search's own field can take focus before this listener is removed on open.
      if (!(target instanceof HTMLElement) || target === document.body || target.closest('[data-search-shell], [data-theme-surface="search"]')) {
        return;
      }
      returnFocus.current = target;
    };
    document.addEventListener('focusin', remember);
    return () => document.removeEventListener('focusin', remember);
  }, [open]);

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) return false;
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (hotkey === 'slash' && isShortcutKey(event, '/', 'Slash') && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        preloadSiteSearch();
        onOpenChange(true);
        return;
      }
      // AltGr arrives as Ctrl+Alt on Windows: that is typing, not Ctrl+K.
      if (isShortcutKey(event, 'k', 'KeyK') && (event.metaKey || event.ctrlKey) && !event.altKey) {
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
      onClose={() => {
        onOpenChange(false);
        returnFocus.current?.focus();
      }}
      placeholder={placeholder?.trim() || t('searchPlaceholder')}
      label={t('searchDocumentation')}
      cancelLabel={t('searchCancel')}
      rtl={resolveReaderDirection(direction, lang) === 'rtl'}
    />
  ) : null;

  return (
    <Suspense fallback={shell}>
      {open || activated ? <SiteSearchDialog {...props} initialQuery={pendingQuery} returnFocus={returnFocus} /> : null}
    </Suspense>
  );
}
