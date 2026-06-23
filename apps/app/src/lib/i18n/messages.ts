/**
 * Dashboard + editor UI strings (Arabic / English). Keyed by dotted namespaces.
 * The locale follows the signed-in user's preference (toggle in the account
 * menu) and drives RTL. Content (pages) is localized separately, per site.
 *
 * To add a string: add the key to `en` and `ar`. `t('missing.key')` falls back
 * to the English value, then the key itself.
 */
export const messages = {
  en: {
    // Brand / generic
    'brand.oss': 'OSS',
    'common.cancel': 'Cancel',
    'common.save': 'Save changes',
    'common.saving': 'Saving…',
    'common.saved': 'Saved',
    'common.delete': 'Delete',
    'common.loading': 'Loading…',

    // Account sidebar nav
    'nav.account': 'Account',
    'nav.sites': 'Sites',
    'nav.analytics': 'Analytics',
    'nav.settings': 'Settings',

    // Account menu
    'account.darkMode': 'Dark mode',
    'account.lightMode': 'Light mode',
    'account.language': 'العربية',
    'account.signOut': 'Sign out',

    // Dashboard home
    'dashboard.title': 'Your sites',
    'dashboard.subtitle': 'All your documentation sites — each with its own settings, members, and plan.',
    'dashboard.newProject': 'New project',
    'dashboard.stats.projects': 'Projects',
    'dashboard.stats.pages': 'Pages',
    'dashboard.stats.deploys': 'Deploys',
    'dashboard.stats.pageViews': 'Page views',
    'dashboard.empty.title': 'No projects yet',
    'dashboard.empty.body': 'Create your first documentation site to get started.',
    'dashboard.pages': '{count} pages',

    // New-site dialog
    'newSite.title': 'New documentation site',
    'newSite.desc': 'Give your docs a name. You can change everything later.',
    'newSite.name': 'Name',
    'newSite.create': 'Create project',
    'newSite.creating': 'Creating…',
    'newSite.created': 'Project created',
    'newSite.error': 'Could not create project',

    // Project top bar
    'project.editor': 'Editor',
    'project.analytics': 'Analytics',
    'project.settings': 'Settings',
    'project.preview': 'Preview',
    'project.publish': 'Publish',
    'project.publishing': 'Publishing…',

    // Settings — section nav
    'settings.heading': 'Site configurations',
    'settings.general': 'General',
    'settings.branding': 'Branding',
    'settings.styling': 'Styling',
    'settings.typography': 'Typography',
    'settings.navbar': 'Navbar',
    'settings.footer': 'Footer',
    'settings.banner': 'Banner',
    'settings.seo': 'SEO',
    'settings.domain': 'Custom domain',
    'settings.search': 'Search',
    'settings.analytics': 'Analytics',
    'settings.redirects': 'Redirects',
    'settings.variables': 'Variables',
    'settings.members': 'Members',
    'settings.plan': 'Plan',
    'settings.danger': 'Danger zone',

    // Editor chrome
    'editor.navigation': 'Navigation',
    'editor.addLanguage': 'Add language',
    'editor.default': 'Default',
    'editor.comments': 'Comments',
    'editor.ai': 'AI',
    'editor.noComments': 'No comments yet.',
    'editor.leaveComment': 'Leave a comment…',
    'editor.comment': 'Comment',
  },
  ar: {
    'brand.oss': 'مفتوح المصدر',
    'common.cancel': 'إلغاء',
    'common.save': 'حفظ التغييرات',
    'common.saving': 'جارٍ الحفظ…',
    'common.saved': 'تم الحفظ',
    'common.delete': 'حذف',
    'common.loading': 'جارٍ التحميل…',

    'nav.account': 'الحساب',
    'nav.sites': 'المواقع',
    'nav.analytics': 'التحليلات',
    'nav.settings': 'الإعدادات',

    'account.darkMode': 'الوضع الداكن',
    'account.lightMode': 'الوضع الفاتح',
    'account.language': 'English',
    'account.signOut': 'تسجيل الخروج',

    'dashboard.title': 'مواقعك',
    'dashboard.subtitle': 'جميع مواقع التوثيق الخاصة بك — لكلٍّ منها إعداداته وأعضاؤه وخطته.',
    'dashboard.newProject': 'موقع جديد',
    'dashboard.stats.projects': 'المواقع',
    'dashboard.stats.pages': 'الصفحات',
    'dashboard.stats.deploys': 'عمليات النشر',
    'dashboard.stats.pageViews': 'مشاهدات الصفحة',
    'dashboard.empty.title': 'لا توجد مواقع بعد',
    'dashboard.empty.body': 'أنشئ أول موقع توثيق لك للبدء.',
    'dashboard.pages': '{count} صفحة',

    'newSite.title': 'موقع توثيق جديد',
    'newSite.desc': 'امنح وثائقك اسمًا. يمكنك تغيير كل شيء لاحقًا.',
    'newSite.name': 'الاسم',
    'newSite.create': 'إنشاء الموقع',
    'newSite.creating': 'جارٍ الإنشاء…',
    'newSite.created': 'تم إنشاء الموقع',
    'newSite.error': 'تعذّر إنشاء الموقع',

    'project.editor': 'المحرر',
    'project.analytics': 'التحليلات',
    'project.settings': 'الإعدادات',
    'project.preview': 'معاينة',
    'project.publish': 'نشر',
    'project.publishing': 'جارٍ النشر…',

    'settings.heading': 'إعدادات الموقع',
    'settings.general': 'عام',
    'settings.branding': 'العلامة التجارية',
    'settings.styling': 'التنسيق',
    'settings.typography': 'الخطوط',
    'settings.navbar': 'شريط التنقل',
    'settings.footer': 'التذييل',
    'settings.banner': 'اللافتة',
    'settings.seo': 'تحسين محركات البحث',
    'settings.domain': 'نطاق مخصّص',
    'settings.search': 'البحث',
    'settings.analytics': 'التحليلات',
    'settings.redirects': 'إعادة التوجيه',
    'settings.variables': 'المتغيّرات',
    'settings.members': 'الأعضاء',
    'settings.plan': 'الخطة',
    'settings.danger': 'منطقة الخطر',

    'editor.navigation': 'التنقّل',
    'editor.addLanguage': 'إضافة لغة',
    'editor.default': 'افتراضي',
    'editor.comments': 'التعليقات',
    'editor.ai': 'الذكاء الاصطناعي',
    'editor.noComments': 'لا توجد تعليقات بعد.',
    'editor.leaveComment': 'اكتب تعليقًا…',
    'editor.comment': 'تعليق',
  },
} as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof (typeof messages)['en'];
