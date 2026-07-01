import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useDirection } from '@/components/direction-provider';
import { type Locale, type MessageKey, messages } from './messages';

const STORAGE_KEY = 'midad.locale';

const readStored = (): Locale => {
  if (typeof window === 'undefined') {
    return 'en';
  }
  return window.localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en';
};

const interpolate = (template: string, vars?: Record<string, string | number>): string =>
  vars ? template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) : template;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Dashboard/editor locale. The selected language drives both the message lookup
 * and the document direction (Arabic → RTL), via the existing DirectionProvider.
 * Must be mounted inside <DirectionProvider>.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const { setDirection } = useDirection();
  const [locale, setLocaleState] = useState<Locale>(() => readStored());

  // Language is the source of truth for direction + <html lang>.
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
    }
    setDirection(locale === 'ar' ? 'rtl' : 'ltr');
  }, [locale, setDirection]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore persistence failures (private mode)
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => interpolate(messages[locale][key] ?? messages.en[key] ?? key, vars),
    [locale],
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
