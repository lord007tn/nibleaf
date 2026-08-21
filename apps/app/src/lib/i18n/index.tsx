import { createContext, type ReactNode, startTransition, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useDirection } from '@/components/direction-provider';
import { DEFAULT_LOCALE, type Locale, localeDetails, resolveLocale } from './locales';
import type { MessageKey } from './messages';

const STORAGE_KEY = 'nibleaf.locale';

const readStored = (): Locale => {
  if (typeof window === 'undefined') {
    return DEFAULT_LOCALE;
  }
  const stored = resolveLocale(window.localStorage.getItem(STORAGE_KEY));
  if (stored) return stored;
  for (const preferred of window.navigator.languages) {
    const locale = resolveLocale(preferred);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
};

const interpolate = (template: string, vars?: Record<string, string | number>): string =>
  vars ? template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) : template;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

export type MessageCatalog = Partial<Record<MessageKey, string>>;
export type MessageCatalogLoader = () => Promise<{ default: Record<string, string> }>;
export type LocaleCatalogLoader = (locale: Exclude<Locale, 'en'>) => ReturnType<MessageCatalogLoader>;

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Dashboard/editor locale. The selected language drives both the message lookup
 * and the document direction (Arabic → RTL), via the existing DirectionProvider.
 * Must be mounted inside <DirectionProvider>.
 */
export function LocaleProvider({
  children,
  englishMessages,
  loadMessages,
}: {
  children: ReactNode;
  englishMessages: Record<string, string>;
  loadMessages: LocaleCatalogLoader;
}) {
  const { setDirection } = useDirection();
  // English on the server and first client render guarantees hydration matches.
  // A persisted Arabic preference is loaded after mount from its own chunk.
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const [activeMessages, setActiveMessages] = useState<MessageCatalog>(englishMessages);
  const requestedLocale = useRef<Locale>(DEFAULT_LOCALE);

  const selectLocale = useCallback(
    (next: Locale) => {
      requestedLocale.current = next;
      if (next === DEFAULT_LOCALE) {
        setActiveMessages(englishMessages);
        setLocaleState(DEFAULT_LOCALE);
        return;
      }
      loadMessages(next).then(({ default: localizedMessages }) => {
        if (requestedLocale.current === next) {
          // A transition never preempts React's selective hydration of a
          // code-split route subtree.
          startTransition(() => {
            setActiveMessages(localizedMessages);
            setLocaleState(next);
          });
        }
      });
    },
    [englishMessages, loadMessages],
  );

  useEffect(() => {
    selectLocale(readStored());
  }, [selectLocale]);

  // Language is the source of truth for direction + <html lang>.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
    setDirection(localeDetails(locale).direction);
  }, [locale, setDirection]);

  const setLocale = useCallback(
    (next: Locale) => {
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore persistence failures (private mode)
      }
      selectLocale(next);
    },
    [selectLocale],
  );

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => interpolate(activeMessages[key] ?? englishMessages[key] ?? key, vars),
    [activeMessages, englishMessages],
  );

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext value={value}>{children}</LocaleContext>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}

/** Convenience hook returning just the translator. */
export const useT = () => useLocale().t;
