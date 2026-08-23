export * from './locales';
export type { MessageKey } from './message-ids';
export type { MessageFn, MessageVariables } from './message-types';
export { getLocale, setLanguage, subscribeLanguage, synchronizeDocumentLanguageFn } from './runtime';
export { translateFn } from './translate';
