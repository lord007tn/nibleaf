import { useCallback, useEffect, useState } from 'react';
import { type Locale, localeDetails, resolveLocale } from './locales';
import bengali from './standalone-catalogs/bn.json';
import german from './standalone-catalogs/de.json';
import spanish from './standalone-catalogs/es.json';
import french from './standalone-catalogs/fr.json';
import hindi from './standalone-catalogs/hi.json';
import indonesian from './standalone-catalogs/id.json';
import brazilianPortuguese from './standalone-catalogs/pt-BR.json';
import russian from './standalone-catalogs/ru.json';
import urdu from './standalone-catalogs/ur.json';
import simplifiedChinese from './standalone-catalogs/zh-CN.json';

const STORAGE_KEY = 'nibleaf.locale';

const standaloneMessages = {
  en: {
    'common.loading': 'Loading…',
    'error.badge': 'Error',
    'error.title': 'Something went wrong',
    'error.unexpected': 'An unexpected error occurred.',
    'error.tryAgain': 'Try again',
    'error.backHome': 'Back home',
    'notFound.badge': '404',
    'notFound.title': 'Page not found',
    'notFound.body': "The page you are looking for doesn't exist or has moved.",
    'notFound.backHome': 'Back home',
  },
  ar: {
    'common.loading': 'جارٍ التحميل…',
    'error.badge': 'خطأ',
    'error.title': 'حدث خطأ ما',
    'error.unexpected': 'حدث خطأ غير متوقع.',
    'error.tryAgain': 'حاول مجددًا',
    'error.backHome': 'العودة إلى الرئيسية',
    'notFound.badge': '404',
    'notFound.title': 'الصفحة غير موجودة',
    'notFound.body': 'الصفحة التي تبحث عنها غير موجودة أو تم نقلها.',
    'notFound.backHome': 'العودة إلى الرئيسية',
  },
  'zh-CN': simplifiedChinese,
  hi: hindi,
  es: spanish,
  fr: french,
  bn: bengali,
  'pt-BR': brazilianPortuguese,
  ru: russian,
  ur: urdu,
  id: indonesian,
  de: german,
} as const;

export type StandaloneMessageKey = keyof (typeof standaloneMessages)['en'];

const readStoredLocale = (): Locale => {
  if (typeof window === 'undefined') return 'en';
  return resolveLocale(window.localStorage.getItem(STORAGE_KEY)) ?? 'en';
};

export const syncStandaloneLocale = (): Locale => {
  const locale = readStoredLocale();
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
    document.documentElement.dir = localeDetails(locale).direction;
  }
  return locale;
};

/** Tiny fallback translator for global loading, error, and 404 boundaries.
 * Keeping it separate prevents the complete dashboard catalog from entering
 * every marketing and published-site route. */
export const translateStandalone = (key: StandaloneMessageKey): string => standaloneMessages[readStoredLocale()][key];

/** Hydration-safe translator for global router boundaries. Each boundary
 * claims its English SSR text before applying a persisted client preference. */
export const useStandaloneT = () => {
  const [locale, setLocale] = useState<Locale>('en');
  useEffect(() => {
    setLocale(syncStandaloneLocale());
  }, []);
  return useCallback((key: StandaloneMessageKey) => standaloneMessages[locale][key], [locale]);
};
