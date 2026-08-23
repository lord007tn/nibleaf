import ar from './locales/ar.json' with { type: 'json' };
import en from './locales/en.json' with { type: 'json' };

const translations = { ar, en } as const;

export type EmailLanguage = keyof typeof translations;
export type EmailTranslationKey = keyof typeof en;

export const DEFAULT_EMAIL_LANGUAGE: EmailLanguage = 'en';

export const createEmailTranslator = (language: EmailLanguage = DEFAULT_EMAIL_LANGUAGE) => ({
  t(key: EmailTranslationKey, params?: Record<string, string>) {
    let value = translations[language][key] ?? en[key];
    for (const [name, replacement] of Object.entries(params ?? {})) {
      value = value.replaceAll(`{{${name}}}`, replacement);
    }
    return value;
  },
});
