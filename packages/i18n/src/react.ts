import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from './locales';
import { MESSAGE_IDS, type MessageKey } from './message-ids';
// biome-ignore lint/suspicious/noTsIgnore: Paraglide generates runtime JavaScript without declaration files.
// @ts-ignore -- Paraglide generates runtime JavaScript without declaration files.
import * as messages from './paraglide/messages.js';
import { getLocale, type MessageFn, type MessageVariables, setLanguage, subscribeLanguage } from './runtime';

export function translateFn(key: MessageKey, variables?: MessageVariables, locale?: Locale): string {
  // biome-ignore lint/performance/noDynamicNamespaceImportAccess: typed dotted keys map to Paraglide's generated identifiers.
  const message = messages[MESSAGE_IDS[key] as keyof typeof messages] as unknown as MessageFn | undefined;
  return message?.(variables, locale ? { locale } : undefined) ?? key;
}

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
