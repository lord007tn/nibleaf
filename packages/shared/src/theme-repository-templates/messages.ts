import { json, type ThemeRepositoryTemplateOptions } from './types';

const THEME_LABELS = {
  harbor: { en: 'Harbor', ar: 'هاربور' },
  manuscript: { en: 'Manuscript', ar: 'المخطوطة' },
  signal: { en: 'Signal', ar: 'سيغنال' },
} as const;

/** Paraglide chrome strings. Every visible label in the generated app is read
 * through these catalogs so Arabic readers get Arabic chrome. */
export const messagesTemplate = ({ templateId }: ThemeRepositoryTemplateOptions): { en: string; ar: string } => ({
  en: json({
    themeLabel: THEME_LABELS[templateId].en,
    skipToContent: 'Skip to content',
    search: 'Search documentation',
    searchResults: 'Search results',
    noSearchResults: 'No pages match this search.',
    language: 'Language',
    version: 'Version',
    documentation: 'Documentation',
    chapters: 'Chapters',
    onThisPage: 'On this page',
    previous: 'Previous',
    next: 'Next',
    menu: 'Open navigation',
    closeMenu: 'Close navigation',
    switchToDark: 'Switch to dark mode',
    switchToLight: 'Switch to light mode',
    notFoundTitle: 'Page not found',
    notFoundBody: 'This page does not exist in the selected language or version.',
    backToStart: 'Back to the first page',
    builtWith: 'Built with Nibleaf',
  }),
  ar: json({
    themeLabel: THEME_LABELS[templateId].ar,
    skipToContent: 'الانتقال إلى المحتوى',
    search: 'ابحث في التوثيق',
    searchResults: 'نتائج البحث',
    noSearchResults: 'لا توجد صفحات مطابقة لهذا البحث.',
    language: 'اللغة',
    version: 'الإصدار',
    documentation: 'التوثيق',
    chapters: 'الفصول',
    onThisPage: 'في هذه الصفحة',
    previous: 'السابق',
    next: 'التالي',
    menu: 'فتح التنقل',
    closeMenu: 'إغلاق التنقل',
    switchToDark: 'التبديل إلى الوضع الداكن',
    switchToLight: 'التبديل إلى الوضع الفاتح',
    notFoundTitle: 'الصفحة غير موجودة',
    notFoundBody: 'هذه الصفحة غير موجودة في اللغة أو الإصدار المحدد.',
    backToStart: 'العودة إلى الصفحة الأولى',
    builtWith: 'مبني باستخدام Nibleaf',
  }),
});
