import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from './locales';
import type { MessageKey } from './message-ids';
import { getLocale, type MessageVariables, renderedLocale, setLanguage, subscribeLanguage } from './runtime';
import { translateFn } from './translate';

export { translateFn } from './translate';

export function useLocale() {
  // Hydrates with the locale the server rendered, so the first client render matches the HTML.
  const locale = useSyncExternalStore(subscribeLanguage, () => getLocale() as Locale, renderedLocale);
  const t = useCallback((key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, locale), [locale]);
  const setLocale = useCallback((next: Locale) => {
    void setLanguage(next);
  }, []);
  return { locale, setLocale, t };
}

export const useT = () => useLocale().t;
