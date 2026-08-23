import { useCallback, useSyncExternalStore } from 'react';
import type { Locale } from './locales';
import { common_loading } from './paraglide/messages/common_loading.js';
import { error_backhome } from './paraglide/messages/error_backhome.js';
import { error_badge } from './paraglide/messages/error_badge.js';
import { error_title } from './paraglide/messages/error_title.js';
import { error_tryagain } from './paraglide/messages/error_tryagain.js';
import { error_unexpected } from './paraglide/messages/error_unexpected.js';
import { notfound_backhome } from './paraglide/messages/notfound_backhome.js';
import { notfound_badge } from './paraglide/messages/notfound_badge.js';
import { notfound_body } from './paraglide/messages/notfound_body.js';
import { notfound_title } from './paraglide/messages/notfound_title.js';
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
