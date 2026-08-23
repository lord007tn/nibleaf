import { type EmailMessageKey, emailT, type MessageVariables } from '@nibleaf/i18n/email';
import { DEFAULT_LOCALE, isRtl, type Locale, resolveLocale } from '@nibleaf/i18n/locales';

export type EmailLanguage = Locale;
export const DEFAULT_EMAIL_LANGUAGE: EmailLanguage = DEFAULT_LOCALE;
export const resolveEmailLanguage = (language?: string | null) => resolveLocale(language) ?? DEFAULT_EMAIL_LANGUAGE;
export const emailDirection = (language: EmailLanguage) => (isRtl(language) ? 'rtl' : 'ltr');

export const createEmailTranslator =
  (language: EmailLanguage = DEFAULT_EMAIL_LANGUAGE) =>
  (key: EmailMessageKey, variables?: MessageVariables) =>
    emailT(language)(key, variables);
