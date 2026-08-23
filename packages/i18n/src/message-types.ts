import type { Locale } from './locales';

export type MessageVariables = Record<string, string | number>;
export type MessageFn = (input?: MessageVariables, options?: { locale?: Locale }) => string;
