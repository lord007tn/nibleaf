export * from './locales';
export type { MessageKey } from './message-ids';
export type { MessageFn, MessageVariables } from './runtime';
export { getLocale, setLanguage, subscribeLanguage, synchronizeDocumentLanguageFn } from './runtime';
