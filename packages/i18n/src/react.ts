import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from './locales';
import type { MessageKey } from './message-ids';
import { getLocale, type MessageVariables, setLanguage, subscribeLanguage } from './runtime';
import { translateFn } from './translate';

export { translateFn } from './translate';

export function useLocale() {
  const locale = useSyncExternalStore(
    subscribeLanguage,
    () => getLocale() as Locale,
    () => 'en' as Locale,
  );
  const t = useCallback((key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, locale), [locale]);
  const setLocale = useCallback((next: Locale) => {
    void setLanguage(next);
  }, []);
  return { locale, setLocale, t };
}

export const useT = () => useLocale().t;
