import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from './locales';
import {
  common_loading,
  error_backhome,
  error_badge,
  error_title,
  error_tryagain,
  error_unexpected,
  notfound_backhome,
  notfound_badge,
  notfound_body,
  notfound_title,
  // biome-ignore lint/suspicious/noTsIgnore: Paraglide generates runtime JavaScript without declaration files.
  // @ts-ignore -- named imports let the bundler retain only this small standalone surface.
} from './paraglide/messages/_index.js';
import { getLocale, type MessageFn, subscribeLanguage, synchronizeDocumentLanguageFn } from './runtime';

const standaloneMessages = {
  'common.loading': common_loading,
  'error.badge': error_badge,
  'error.title': error_title,
  'error.unexpected': error_unexpected,
  'error.tryAgain': error_tryagain,
  'error.backHome': error_backhome,
  'notFound.badge': notfound_badge,
  'notFound.title': notfound_title,
  'notFound.body': notfound_body,
  'notFound.backHome': notfound_backhome,
} satisfies Record<string, MessageFn>;

export type StandaloneMessageKey = keyof typeof standaloneMessages;
export const syncStandaloneLocale = synchronizeDocumentLanguageFn;
export const translateStandalone = (key: StandaloneMessageKey, locale = getLocale() as Locale): string =>
  standaloneMessages[key](undefined, { locale });

export const useStandaloneT = () => {
  const locale = useSyncExternalStore(
    subscribeLanguage,
    () => getLocale() as Locale,
    () => 'en' as Locale,
  );
  return useCallback((key: StandaloneMessageKey) => translateStandalone(key, locale), [locale]);
};
