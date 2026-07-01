/**
 * Localized strings for the published-site chrome (nav, search, pager, states).
 * Keyed by the site's active language so an Arabic site renders Arabic chrome to
 * match its content + RTL. Only the shipped locales are translated; any other
 * language falls back to English.
 */

const MESSAGES = {
  en: {
    docs: 'Docs',
    changelog: 'Changelog',
    search: 'Search…',
    searchDocumentation: 'Search documentation',
    searchPlaceholder: 'Search documentation…',
    searchDescription: 'Full-text and fuzzy search across this site.',
    searchEmpty: 'No results.',
    searchPrompt: 'Type to search…',
    results: 'Results',
    loading: 'Loading…',
    previous: 'Previous',
    next: 'Next',
    onThisPage: 'On this page',
    notPublishedTitle: 'Not published yet',
    notPublishedBody: "This documentation site hasn't been published. Publish it from the editor to see it live.",
    pageUnavailable: 'This page is not available.',
    changelogSubtitle: 'Every update shipped to these docs.',
    changelogEmpty: 'No releases yet.',
    changelogRelease: 'Release',
    changelogPage: 'page',
    changelogPages: 'pages',
    feedbackQuestion: 'Was this page helpful?',
    feedbackYes: 'Yes',
    feedbackNo: 'No',
    feedbackThanks: 'Thanks for the feedback.',
    editPage: 'Edit this page',
    raiseIssue: 'Raise an issue',
    analyticsConsentBody: 'This site uses optional analytics cookies to understand traffic.',
    analyticsConsentAccept: 'Accept',
    analyticsConsentDecline: 'Decline',
  },
  ar: {
    docs: 'الوثائق',
    changelog: 'سجل التغييرات',
    search: 'بحث…',
    searchDocumentation: 'البحث في الوثائق',
    searchPlaceholder: 'ابحث في الوثائق…',
    searchDescription: 'بحث نصي كامل وتقريبي عبر هذا الموقع.',
    searchEmpty: 'لا توجد نتائج.',
    searchPrompt: 'اكتب للبحث…',
    results: 'النتائج',
    loading: 'جارٍ التحميل…',
    previous: 'السابق',
    next: 'التالي',
    onThisPage: 'في هذه الصفحة',
    notPublishedTitle: 'لم يُنشر بعد',
    notPublishedBody: 'لم يتم نشر موقع الوثائق هذا. انشره من المحرر لرؤيته مباشرةً.',
    pageUnavailable: 'هذه الصفحة غير متاحة.',
    changelogSubtitle: 'كل تحديث صدر لهذه الوثائق.',
    changelogEmpty: 'لا توجد إصدارات بعد.',
    changelogRelease: 'إصدار',
    changelogPage: 'صفحة',
    changelogPages: 'صفحات',
    feedbackQuestion: 'هل كانت هذه الصفحة مفيدة؟',
    feedbackYes: 'نعم',
    feedbackNo: 'لا',
    feedbackThanks: 'شكرًا على الملاحظة.',
    editPage: 'تحرير هذه الصفحة',
    raiseIssue: 'فتح مشكلة',
    analyticsConsentBody: 'يستخدم هذا الموقع ملفات تعريف ارتباط اختيارية للتحليلات لفهم الزيارات.',
    analyticsConsentAccept: 'قبول',
    analyticsConsentDecline: 'رفض',
  },
} as const;

type SiteLocale = keyof typeof MESSAGES;
export type SiteMessageKey = keyof (typeof MESSAGES)['en'];

/** Resolve a language code (e.g. `ar`, `ar-SA`) to a shipped locale, else English. */
const resolveLocale = (langCode?: string): SiteLocale => {
  const base = (langCode ?? 'en').toLowerCase().split('-')[0] ?? 'en';
  return base in MESSAGES ? (base as SiteLocale) : 'en';
};

/** Translator for the published-site chrome, bound to the active language. */
export function siteT(langCode?: string): (key: SiteMessageKey) => string {
  const locale = resolveLocale(langCode);
  return (key) => MESSAGES[locale][key] ?? MESSAGES.en[key];
}
