import { siteT } from '@nibleaf/i18n/site';
import { Search } from 'lucide-react';
import { type ComponentProps, type KeyboardEvent, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { beginSearchKeystrokes, cancelSearchKeystrokes, holdSearchKeystrokes } from '@/components/site/site-search-keystrokes';
import { isShortcutKey } from '@/lib/site-keyboard';
import { resolveReaderDirection } from '@/lib/text-direction';

// Whether the dialog's code is already here: then search opens without the shell.
let dialogLoaded = false;
const loadSiteSearchDialog = () =>
  import('./site-search-dialog').then((module) => {
    dialogLoaded = true;
    return module;
  });
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
 * Opens search from a trigger's click (or any other reader action): starts
 * keeping keystrokes inside the click itself, so text typed before the dialog's
 * field is ready is kept and a phone raises its keyboard at once.
 */
export const openSiteSearch = (open: () => void, label?: string): void => {
  preloadSiteSearch();
  beginSearchKeystrokes({ label });
  open();
};

/**
 * Stand-in shown only while the dialog's code is still downloading. It is a
 * small modal of its own (named, Esc / Cancel / outside tap to close, focus kept
 * inside) whose field holds whatever the reader types (see
 * site-search-keystrokes.ts); the dialog then takes all of it, so the letters
 * typed after ⌘K are never lost.
 */
export function SearchShell({
  onClose,
  placeholder,
  label,
  cancelLabel,
  rtl,
}: {
  onClose: () => void;
  placeholder: string;
  label: string;
  cancelLabel: string;
  rtl: boolean;
}) {
  // Stable, so the field keeps holding the text across re-renders.
  const holdKeystrokes = useCallback((field: HTMLInputElement | null) => (field ? holdSearchKeystrokes(field, label) : undefined), [label]);
  return (
    // Above the dialog: while a composition finishes in this field, the dialog may
    // already be mounted underneath, waiting for the text.
    <div className="fixed inset-0 z-[60]" data-search-shell="">
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
            // Takes focus from the hidden field once no IME composition is open there
            // (holdSearchKeystrokes), never mid-composition, so no autoFocus.
            ref={holdKeystrokes}
            aria-label={label}
            dir="auto"
            placeholder={placeholder}
            maxLength={300}
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
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

export function SiteSearch(props: Omit<ComponentProps<typeof SiteSearchDialog>, 'returnFocus' | 'onFieldReady'>) {
  const { open, onOpenChange, hotkey, lang, direction, placeholder } = props;
  const [activated, setActivated] = useState(open);
  // The loading shell shows from the moment search opens until the dialog's
  // field has taken the text and focus. It is a sibling of the dialog, not its
  // Suspense fallback, so a composition in its field is never cut by the dialog
  // arriving. A dialog whose code is already loaded opens without it.
  const [shellWanted, setShellWanted] = useState(() => open && !dialogLoaded);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setShellWanted(open && !dialogLoaded);
  }
  // Where focus returns when search closes: the last element focused outside it.
  const returnFocus = useRef<HTMLElement | null>(null);
  // Preserve the dialog's selected mode and query after its first opening.
  useEffect(() => {
    if (open) setActivated(true);
    // Closed: stop keeping keystrokes (the dialog takes them when it opens).
    else cancelSearchKeystrokes();
  }, [open]);
  useEffect(() => () => cancelSearchKeystrokes(), []);

  useEffect(() => {
    if (open) return;
    const remember = (event: FocusEvent) => {
      const target = event.target;
      // Search's own field can take focus before this listener is removed on open.
      if (
        !(target instanceof HTMLElement) ||
        target === document.body ||
        target.closest('[data-search-shell], [data-theme-surface="search"], [data-search-keystrokes]')
      ) {
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
    // Keys typed right after the shortcut go into a hidden field focused within
    // this same key press, until search's own field takes them over.
    const startSearch = () => {
      preloadSiteSearch();
      beginSearchKeystrokes({
        label: siteT(lang)('searchDocumentation'),
        onCancel: () => {
          onOpenChange(false);
          returnFocus.current?.focus();
        },
      });
      onOpenChange(true);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (hotkey === 'slash' && isShortcutKey(event, '/', 'Slash') && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        if (!open) startSearch();
        return;
      }
      // AltGr arrives as Ctrl+Alt on Windows: that is typing, not Ctrl+K.
      if (isShortcutKey(event, 'k', 'KeyK') && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        if (open) onOpenChange(false);
        else startSearch();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange, hotkey, lang]);

  const t = siteT(lang);
  const shell =
    open && shellWanted ? (
      <SearchShell
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
    <>
      {shell}
      <Suspense fallback={null}>
        {open || activated ? <SiteSearchDialog {...props} returnFocus={returnFocus} onFieldReady={() => setShellWanted(false)} /> : null}
      </Suspense>
    </>
  );
}
