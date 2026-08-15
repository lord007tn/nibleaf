import type { Locale } from './messages';

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
} as const;

export type StandaloneMessageKey = keyof (typeof standaloneMessages)['en'];

const readStoredLocale = (): Locale => {
  if (typeof window === 'undefined') return 'en';
  return window.localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en';
};

/** Tiny fallback translator for global loading, error, and 404 boundaries.
 * Keeping it separate prevents the complete dashboard catalog from entering
 * every marketing and published-site route. */
export const translateStandalone = (key: StandaloneMessageKey): string => standaloneMessages[readStoredLocale()][key];
