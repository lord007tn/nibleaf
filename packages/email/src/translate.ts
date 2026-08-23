import { type EmailMessageKey, emailT, type MessageVariables } from '@nibleaf/i18n/email';

export type EmailLanguage = 'ar' | 'en';
export const DEFAULT_EMAIL_LANGUAGE: EmailLanguage = 'en';

export const createEmailTranslator =
  (language: EmailLanguage = DEFAULT_EMAIL_LANGUAGE) =>
  (key: EmailMessageKey, variables?: MessageVariables) =>
    emailT(language)(key, variables);
