import type { ShellCopy } from './types';

/** Arabic count phrase for GitHub stars: 1 نجمة واحدة، 2 نجمتان، 3–10 نجوم، 11+ نجمة. */
function arabicStars(count: number): string {
  if (count === 1) return 'نجمة واحدة';
  if (count === 2) return 'نجمتان';
  const n = count.toLocaleString('en-US');
  const mod100 = count % 100;
  if (mod100 >= 3 && mod100 <= 10) return `${n} نجوم`;
  return `${n} نجمة`;
}

// Every link target below exists today.
export const shellAr: ShellCopy = {
  skipToContent: 'انتقل إلى المحتوى',
  homeLabel: 'الصفحة الرئيسية لـ Nibleaf',
  primaryNavLabel: 'التنقل الرئيسي',
  nav: [
    { label: 'المزايا', href: '/ar#features' },
    { label: 'حالات الاستخدام', href: '/ar#use-cases' },
    { label: 'الأسعار', href: '/ar/pricing' },
    { label: 'الوثائق', href: 'https://docs.nibleaf.com?lang=ar', external: true },
    { label: 'الاستضافة الذاتية', href: '/ar/self-hosting' },
  ],
  login: { label: 'تسجيل الدخول', href: '/sign-in' },
  start: { label: 'ابدأ مجانًا', href: '/sign-up' },
  languageSwitch: { label: 'English', ariaLabel: 'Read this page in English', hrefLang: 'en' },
  theme: { darkMode: 'الوضع الداكن', toDark: 'التبديل إلى الوضع الداكن', toLight: 'التبديل إلى الوضع الفاتح' },
  menu: { open: 'افتح القائمة', close: 'أغلق القائمة', title: 'القائمة' },
  github: {
    label: 'GitHub',
    starsLabel: (count) => `${arabicStars(count)} على GitHub`,
  },
  footer: {
    tagline: 'منصة توثيق ومركز مساعدة مفتوحة المصدر، والعربية فيها لغة أساسية.',
    openSource: {
      badge: 'مفتوح المصدر · AGPL-3.0',
      heading: 'وثائق تملكها أنت.',
      body: 'اقرأ الشيفرة، أو شغّل Nibleaf على خوادمك، أو ابدأ على السحابة مجانًا خلال المرحلة التجريبية.',
    },
    columns: [
      {
        title: 'المنتج',
        links: [
          { label: 'المزايا', href: '/ar#features' },
          { label: 'Nibleaf Cloud', href: '/cloud' },
          { label: 'الأسعار', href: '/ar/pricing' },
          { label: 'الاستضافة الذاتية', href: '/ar/self-hosting' },
          { label: 'الإصدارات', href: 'https://github.com/lord007tn/nibleaf/releases', external: true },
        ],
      },
      {
        title: 'حالات الاستخدام',
        links: [
          { label: 'فرق الدعم', href: '/ar/use-cases/support-teams' },
          { label: 'فرق المنتج', href: '/ar/use-cases/product-docs' },
          { label: 'المطورون', href: '/ar/use-cases/api-docs' },
        ],
      },
      {
        title: 'المقارنات',
        links: [
          { label: 'منصات التوثيق للفرق العربية', href: '/ar/documentation-platforms' },
          { label: 'مقابل Mintlify', href: '/compare/nibleaf-vs-mintlify' },
          { label: 'مقابل GitBook', href: '/compare/nibleaf-vs-gitbook' },
          { label: 'مقابل Docusaurus', href: '/compare/nibleaf-vs-docusaurus' },
          { label: 'بدائل Mintlify', href: '/alternatives/mintlify' },
          { label: 'بدائل GitBook', href: '/alternatives/gitbook' },
          { label: 'بدائل ReadMe', href: '/alternatives/readme' },
        ],
      },
      {
        title: 'موارد',
        links: [
          { label: 'الوثائق', href: 'https://docs.nibleaf.com?lang=ar', external: true },
          { label: 'المدونة', href: '/blog' },
          { label: 'الأدلة العربية', href: '/ar/guides' },
          { label: 'للمطورين', href: '/developers' },
          { label: 'أداة فحص جاهزية RTL', href: '/tools/rtl-documentation-readiness' },
        ],
      },
      {
        title: 'الشركة',
        links: [
          { label: 'من نحن', href: '/about' },
          { label: 'تواصل معنا', href: '/contact' },
          { label: 'الشروط', href: '/terms' },
          { label: 'الخصوصية', href: '/privacy' },
        ],
      },
    ],
    legalLine: (year) => `© ${year} Nibleaf. نبنيه علنًا بترخيص AGPL-3.0.`,
    licenseLabel: 'AGPL-3.0-only',
    sourceLabel: 'الشيفرة المصدرية',
  },
};
