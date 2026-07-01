/**
 * Marketing-site UI strings (Arabic / English), keyed by dotted namespaces.
 *
 * Self-contained i18n for apps/www, mirroring the dashboard pattern. The locale
 * persists in localStorage (`midad.www.locale`, default 'en') and drives the
 * document direction (Arabic → RTL) plus <html lang>. The site SSRs in English;
 * the effect below sets dir/lang on the client after mount.
 *
 * To add a string: add the key to both `en` and `ar`. The MessageKey union is
 * derived from `en`, so a missing Arabic key is caught at typecheck.
 */
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const messages = {
  en: {
    // Nav
    'nav.features': 'Features',
    'nav.compare': 'vs Mintlify',
    'nav.selfHost': 'Self-host',
    'nav.pricing': 'Pricing',
    'nav.signIn': 'Sign in',
    'nav.getStarted': 'Get started',
    'nav.github': 'GitHub',
    'nav.language': 'العربية',

    // Hero
    'hero.badge': 'Open source · self-hostable · AGPL-3.0',
    'hero.headlineLead': 'Beautiful docs,',
    'hero.headlineAccent': 'on your own infrastructure.',
    'hero.subhead':
      'Midad is the open-source documentation platform. Write in Markdown, get a fast, searchable site with versioned publishing, custom domains, and analytics — self-hosted with one Docker command.',
    'hero.ctaPrimary': 'Start writing — free',
    'hero.ctaSecondary': 'Star on GitHub',
    'hero.terminal': 'docker compose up -d',
    'palette.label': 'Midad brand palette',

    // Trust strip
    'trust.prefix': 'Built on a stack you control:',

    // Features
    'features.heading': 'Everything you need to ship docs',
    'features.subhead': 'The polish of a hosted platform, with the freedom of open source.',
    'features.editor.title': 'Markdown editor',
    'features.editor.body': 'A focused editor with live preview, page tree, groups, and drag-to-reorder. Write fast, ship faster.',
    'features.search.title': 'Hybrid search',
    'features.search.body': 'Full-text + fuzzy search powered by Orama, built into every published site. Instant ⌘K results.',
    'features.publishing.title': 'Versioned publishing',
    'features.publishing.body': 'Every publish snapshots your docs. Roll forward safely; your live site never serves a half-written page.',
    'features.domains.title': 'Custom domains',
    'features.domains.body': 'Bring your own domain with guided DNS records and one-click verification.',
    'features.analytics.title': 'Analytics',
    'features.analytics.body': 'See page views, unique visitors, top pages, and what people search for — no third-party tracker.',
    'features.selfHost.title': 'Self-host first',
    'features.selfHost.body': 'Postgres, a Redis-compatible cache, and S3-compatible storage. Runs anywhere Docker does. Your data stays yours.',

    // Comparison
    'compare.heading': 'Midad vs hosted-only platforms',
    'compare.subhead': 'The same great authoring experience — without the lock-in.',
    'compare.colMidad': 'Midad',
    'compare.colHosted': 'Hosted',
    'compare.row.openSource': 'Open source',
    'compare.row.selfHost': 'Self-host on your infra',
    'compare.row.ownData': 'Own your data & storage',
    'compare.row.editor': 'Markdown editor + live preview',
    'compare.row.search': 'Built-in search',
    'compare.row.domains': 'Custom domains',
    'compare.row.noLockIn': 'No per-seat lock-in',

    // Self-host
    'selfHost.heading': 'Self-host in 90 seconds',
    'selfHost.body':
      'Clone the repo, copy the env file, and bring the whole stack up with Docker Compose — app, API, worker, Postgres, cache, and object storage.',
    'selfHost.bullet.migrations': 'Postgres + Prisma migrations run automatically',
    'selfHost.bullet.worker': 'BullMQ worker builds & indexes your published docs',
    'selfHost.bullet.storage': 'Any S3-compatible storage (maxio, R2, S3, B2) for assets',
    'selfHost.bullet.account': 'Create your account on first run — no demo credentials in production',
    'selfHost.terminal.label': 'terminal',

    // Pricing
    'pricing.heading': 'Simple, honest pricing',
    'pricing.subhead': 'Self-host for free today. Cloud-hosted Midad is coming soon.',
    'pricing.popular': 'Popular',
    'pricing.selfHosted.name': 'Self-hosted',
    'pricing.selfHosted.price': 'Free',
    'pricing.selfHosted.tagline': 'Forever, on your own servers.',
    'pricing.selfHosted.feature.unlimited': 'Unlimited sites & pages',
    'pricing.selfHosted.feature.members': 'Unlimited members',
    'pricing.selfHosted.feature.search': 'Search, analytics, custom domains',
    'pricing.selfHosted.feature.community': 'Community support',
    'pricing.selfHosted.cta': 'Get the source',
    'pricing.cloud.name': 'Cloud-hosted',
    'pricing.cloud.price': 'Soon',
    'pricing.cloud.tagline': 'Managed Midad is not live yet — join the waitlist.',
    'pricing.cloud.feature.everything': 'Everything in self-hosted',
    'pricing.cloud.feature.managed': 'Managed Postgres & storage',
    'pricing.cloud.feature.upgrades': 'Automatic upgrades',
    'pricing.cloud.feature.priority': 'Priority support',
    'pricing.cloud.cta': 'Join the waitlist',

    // FAQ
    'faq.heading': 'Frequently asked',
    'faq.free.q': 'Is Midad really free?',
    'faq.free.a': 'Yes. The self-hosted version is open source and free to run on your own infrastructure, forever.',
    'faq.selfHost.q': 'What do I need to self-host?',
    'faq.selfHost.a':
      'Docker and Docker Compose. The stack includes Postgres, a Redis-compatible cache, and S3-compatible object storage — all wired up for you.',
    'faq.storage.q': 'Can I use my own object storage?',
    'faq.storage.a': 'Absolutely. Midad speaks the S3 API, so it works with MinIO, Cloudflare R2, AWS S3, or Backblaze B2.',
    'faq.search.q': 'How does search work?',
    'faq.search.a': 'Every published site is indexed with Orama for full-text and fuzzy search, served directly from your API — no external service.',

    // Call to action
    'cta.heading': 'Ship docs your users will love',
    'cta.body': 'Self-host today. Cloud-hosted Midad is coming soon, with the same ownership-first defaults.',
    'cta.primary': 'Get started free',
    'cta.secondary': 'View on GitHub',

    // Footer
    'footer.tagline': '— open-source docs',
    'footer.github': 'GitHub',
    'footer.dashboard': 'Dashboard',
    'footer.terms': 'Terms',
    'footer.privacy': 'Privacy',
    'footer.license': 'AGPL-3.0 licensed',

    // Legal — shared
    'legal.back': 'Back to home',
    'legal.lastUpdated': 'Last updated: {date}',

    // Terms
    'terms.title': 'Terms of Service',
    'terms.s1.heading': '1. Acceptance of terms',
    'terms.s1.body':
      'By accessing or using Midad (the "Service") you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Service. As Midad is self-hosted software, the operator of each deployment should review and adapt these terms with their own legal counsel.',
    'terms.s2.heading': '2. The open-source license',
    'terms.s2.body':
      "Midad is distributed under the GNU Affero General Public License v3.0 (AGPL-3.0). The license that ships with the source code governs your rights to use, copy, modify, and distribute the software, and — under the AGPL's network-use clause — to receive the corresponding source of any modified version offered to you over a network. Nothing in these terms limits the rights granted to you under that open-source license.",
    'terms.s3.heading': '3. Self-hosted deployments',
    'terms.s3.body':
      'When you self-host Midad, you are solely responsible for your own infrastructure, configuration, data, security, and compliance. The Service is provided "as is" without warranties of any kind, to the maximum extent permitted by applicable law.',
    'terms.s4.heading': '4. Acceptable use',
    'terms.s4.body':
      'You agree not to use the Service to violate any law, infringe the rights of others, or distribute unlawful, harmful, or malicious content. Replace this section with the specific policies that apply to your deployment.',
    'terms.s5.heading': '5. Limitation of liability',
    'terms.s5.body':
      'To the fullest extent permitted by law, the authors and copyright holders shall not be liable for any claim, damages, or other liability arising from the use of the Service.',
    'terms.s6.heading': '6. Changes to these terms',
    'terms.s6.body':
      'We may update these terms from time to time. Continued use of the Service after changes take effect constitutes acceptance of the revised terms.',

    // Privacy
    'privacy.title': 'Privacy Policy',
    'privacy.s1.heading': '1. Your data stays yours',
    'privacy.s1.body':
      "Midad is self-hosted by design. When you run Midad on your own infrastructure, your content and your users' data live in your own database and object storage — not ours. This is placeholder copy; replace it with a policy reviewed by your own legal counsel.",
    'privacy.s2.heading': '2. What we collect',
    'privacy.s2.body':
      'The marketing site itself does not use third-party analytics or trackers. Any data processed by your Midad deployment is governed by the privacy policy you publish to your own users, not by this document.',
    'privacy.s3.heading': '3. Built-in analytics',
    'privacy.s3.body':
      'Midad includes first-party analytics (page views, unique visitors, top pages and searches) that run entirely within your deployment. No data is sent to any external analytics provider unless you configure one.',
    'privacy.s4.heading': '4. Cookies',
    'privacy.s4.body':
      'Authentication uses first-party session cookies issued by your own deployment. Document the specific cookies your instance sets when you adapt this policy for production.',
    'privacy.s5.heading': '5. Data requests',
    'privacy.s5.body':
      'Because you control the infrastructure, you are the data controller for your deployment. Provide your own contact details and process for handling access, correction, and deletion requests here.',
    'privacy.s6.heading': '6. Changes to this policy',
    'privacy.s6.body': 'We may update this policy from time to time. Material changes will be reflected by the "last updated" date above.',
  },
  ar: {
    // Nav
    'nav.features': 'المزايا',
    'nav.compare': 'مقارنةً بـ Mintlify',
    'nav.selfHost': 'الاستضافة الذاتية',
    'nav.pricing': 'الأسعار',
    'nav.signIn': 'تسجيل الدخول',
    'nav.getStarted': 'ابدأ الآن',
    'nav.github': 'GitHub',
    'nav.language': 'EN',

    // Hero
    'hero.badge': 'مفتوح المصدر · قابل للاستضافة الذاتية · AGPL-3.0',
    'hero.headlineLead': 'توثيق أنيق،',
    'hero.headlineAccent': 'على بنيتك التحتية الخاصة.',
    'hero.subhead':
      'مِداد منصة توثيق مفتوحة المصدر. اكتب بصيغة Markdown واحصل على موقع سريع وقابل للبحث مع نشر موثّق بالإصدارات ونطاقات مخصصة وتحليلات — واستضفه ذاتيًا بأمر Docker واحد.',
    'hero.ctaPrimary': 'ابدأ الكتابة — مجانًا',
    'hero.ctaSecondary': 'أضف نجمة على GitHub',
    'hero.terminal': 'docker compose up -d',
    'palette.label': 'لوحة ألوان مِداد',

    // Trust strip
    'trust.prefix': 'مبنية على حزمة تقنية تتحكم بها بالكامل:',

    // Features
    'features.heading': 'كل ما تحتاجه لنشر توثيقك',
    'features.subhead': 'إتقان المنصات المُستضافة، مع حرية المصدر المفتوح.',
    'features.editor.title': 'محرّر Markdown',
    'features.editor.body': 'محرّر مُركّز مع معاينة حية وشجرة صفحات ومجموعات وإعادة ترتيب بالسحب. اكتب بسرعة وانشر أسرع.',
    'features.search.title': 'بحث هجين',
    'features.search.body': 'بحث نصي كامل وتقريبي مدعوم بـ Orama، مدمج في كل موقع منشور. نتائج فورية عبر ⌘K.',
    'features.publishing.title': 'نشر موثّق بالإصدارات',
    'features.publishing.body': 'كل عملية نشر تلتقط لقطة من توثيقك. تقدّم بأمان؛ ولن يقدّم موقعك الحي صفحة غير مكتملة أبدًا.',
    'features.domains.title': 'نطاقات مخصصة',
    'features.domains.body': 'استخدم نطاقك الخاص مع سجلات DNS موجّهة وتحقّق بنقرة واحدة.',
    'features.analytics.title': 'تحليلات',
    'features.analytics.body': 'اطّلع على مشاهدات الصفحات والزوار الفريدين وأبرز الصفحات وما يبحث عنه الناس — بدون أي متعقّب خارجي.',
    'features.selfHost.title': 'الاستضافة الذاتية أولًا',
    'features.selfHost.body': 'Postgres وذاكرة تخزين مؤقت متوافقة مع Redis وتخزين متوافق مع S3. يعمل أينما يعمل Docker. بياناتك تبقى ملكك.',

    // Comparison
    'compare.heading': 'مِداد مقابل المنصات المُستضافة فقط',
    'compare.subhead': 'تجربة التأليف الرائعة نفسها — بدون قيود الاحتكار.',
    'compare.colMidad': 'مِداد',
    'compare.colHosted': 'مُستضاف',
    'compare.row.openSource': 'مفتوح المصدر',
    'compare.row.selfHost': 'استضافة ذاتية على بنيتك التحتية',
    'compare.row.ownData': 'ملكية بياناتك وتخزينك',
    'compare.row.editor': 'محرّر Markdown مع معاينة حية',
    'compare.row.search': 'بحث مدمج',
    'compare.row.domains': 'نطاقات مخصصة',
    'compare.row.noLockIn': 'بلا احتكار حسب المقعد',

    // Self-host
    'selfHost.heading': 'استضف ذاتيًا في 90 ثانية',
    'selfHost.body':
      'استنسخ المستودع وانسخ ملف البيئة وشغّل الحزمة بالكامل عبر Docker Compose — التطبيق وواجهة API والعامل وPostgres والذاكرة المؤقتة والتخزين الكائني.',
    'selfHost.bullet.migrations': 'ترحيلات Postgres وPrisma تُنفَّذ تلقائيًا',
    'selfHost.bullet.worker': 'عامل BullMQ يبني توثيقك المنشور ويفهرسه',
    'selfHost.bullet.storage': 'أي تخزين متوافق مع S3 (maxio أو R2 أو S3 أو B2) للأصول',
    'selfHost.bullet.account': 'أنشئ حسابك عند أول تشغيل — بلا بيانات اعتماد تجريبية في الإنتاج',
    'selfHost.terminal.label': 'الطرفية',

    // Pricing
    'pricing.heading': 'تسعير بسيط وصادق',
    'pricing.subhead': 'استضف ذاتيًا مجانًا اليوم. النسخة السحابية من مِداد قادمة قريبًا.',
    'pricing.popular': 'الأكثر شيوعًا',
    'pricing.selfHosted.name': 'الاستضافة الذاتية',
    'pricing.selfHosted.price': 'مجانًا',
    'pricing.selfHosted.tagline': 'إلى الأبد، على خوادمك الخاصة.',
    'pricing.selfHosted.feature.unlimited': 'مواقع وصفحات بلا حدود',
    'pricing.selfHosted.feature.members': 'أعضاء بلا حدود',
    'pricing.selfHosted.feature.search': 'بحث وتحليلات ونطاقات مخصصة',
    'pricing.selfHosted.feature.community': 'دعم المجتمع',
    'pricing.selfHosted.cta': 'احصل على المصدر',
    'pricing.cloud.name': 'النسخة السحابية',
    'pricing.cloud.price': 'قريبًا',
    'pricing.cloud.tagline': 'مِداد المُدار ليس متاحًا بعد — انضم إلى قائمة الانتظار.',
    'pricing.cloud.feature.everything': 'كل ما في الاستضافة الذاتية',
    'pricing.cloud.feature.managed': 'Postgres وتخزين مُدار',
    'pricing.cloud.feature.upgrades': 'ترقيات تلقائية',
    'pricing.cloud.feature.priority': 'دعم بأولوية',
    'pricing.cloud.cta': 'انضم إلى قائمة الانتظار',

    // FAQ
    'faq.heading': 'الأسئلة الشائعة',
    'faq.free.q': 'هل مِداد مجاني فعلًا؟',
    'faq.free.a': 'نعم. النسخة المُستضافة ذاتيًا مفتوحة المصدر ومجانية للتشغيل على بنيتك التحتية الخاصة، إلى الأبد.',
    'faq.selfHost.q': 'ما الذي أحتاجه للاستضافة الذاتية؟',
    'faq.selfHost.a':
      'Docker وDocker Compose. تتضمن الحزمة Postgres وذاكرة تخزين مؤقت متوافقة مع Redis وتخزينًا كائنيًا متوافقًا مع S3 — كلها مُهيّأة لك مسبقًا.',
    'faq.storage.q': 'هل يمكنني استخدام تخزيني الكائني الخاص؟',
    'faq.storage.a': 'بالتأكيد. يدعم مِداد واجهة S3، لذا يعمل مع MinIO أو Cloudflare R2 أو AWS S3 أو Backblaze B2.',
    'faq.search.q': 'كيف يعمل البحث؟',
    'faq.search.a': 'يُفهرَس كل موقع منشور باستخدام Orama لبحث نصي كامل وتقريبي، يُقدَّم مباشرةً من واجهة API الخاصة بك — بلا خدمة خارجية.',

    // Call to action
    'cta.heading': 'انشر توثيقًا سيحبه مستخدموك',
    'cta.body': 'استضف ذاتيًا اليوم. النسخة السحابية من مِداد قادمة قريبًا، وبنفس مبادئ ملكية المحتوى.',
    'cta.primary': 'ابدأ مجانًا',
    'cta.secondary': 'استعرض على GitHub',

    // Footer
    'footer.tagline': '— توثيق مفتوح المصدر',
    'footer.github': 'GitHub',
    'footer.dashboard': 'لوحة التحكم',
    'footer.terms': 'الشروط',
    'footer.privacy': 'الخصوصية',
    'footer.license': 'مُرخّص بـ AGPL-3.0',

    // Legal — shared
    'legal.back': 'العودة إلى الرئيسية',
    'legal.lastUpdated': 'آخر تحديث: {date}',

    // Terms
    'terms.title': 'شروط الخدمة',
    'terms.s1.heading': '1. قبول الشروط',
    'terms.s1.body':
      'باستخدامك مِداد («الخدمة») أو الوصول إليها، فإنك توافق على الالتزام بشروط الخدمة هذه. إذا لم توافق على هذه الشروط، فلا تستخدم الخدمة. وبما أن مِداد برنامج مُستضاف ذاتيًا، ينبغي على مُشغّل كل عملية نشر مراجعة هذه الشروط وتكييفها بالاستعانة بمستشاره القانوني.',
    'terms.s2.heading': '2. رخصة المصدر المفتوح',
    'terms.s2.body':
      'يُوزَّع مِداد بموجب رخصة جنو العمومية العامة أفيرو الإصدار 3.0 (AGPL-3.0). الرخصة المرفقة مع الشيفرة المصدرية تحكم حقوقك في استخدام البرنامج ونسخه وتعديله وتوزيعه، وكذلك — بموجب بند الاستخدام الشبكي في AGPL — في الحصول على الشيفرة المصدرية المقابلة لأي نسخة معدّلة تُقدَّم إليك عبر الشبكة. ولا يحدّ أي بند في هذه الشروط من الحقوق الممنوحة لك بموجب تلك الرخصة مفتوحة المصدر.',
    'terms.s3.heading': '3. عمليات النشر المُستضافة ذاتيًا',
    'terms.s3.body':
      'عند استضافتك مِداد ذاتيًا، تتحمل وحدك مسؤولية بنيتك التحتية وإعداداتك وبياناتك وأمنك والامتثال للأنظمة. تُقدَّم الخدمة «كما هي» دون أي ضمانات من أي نوع، إلى أقصى حد يسمح به القانون المعمول به.',
    'terms.s4.heading': '4. الاستخدام المقبول',
    'terms.s4.body':
      'توافق على عدم استخدام الخدمة لمخالفة أي قانون أو انتهاك حقوق الآخرين أو نشر محتوى غير قانوني أو ضار أو خبيث. استبدل هذا القسم بالسياسات المحددة المنطبقة على عملية نشرك.',
    'terms.s5.heading': '5. تحديد المسؤولية',
    'terms.s5.body':
      'إلى أقصى حد يسمح به القانون، لا يتحمل المؤلفون وأصحاب حقوق النشر أي مسؤولية عن أي مطالبة أو أضرار أو أي مسؤولية أخرى تنشأ عن استخدام الخدمة.',
    'terms.s6.heading': '6. التغييرات على هذه الشروط',
    'terms.s6.body': 'قد نُحدِّث هذه الشروط من حين لآخر. ويُعدّ استمرار استخدامك للخدمة بعد سريان التغييرات قبولًا للشروط المُحدَّثة.',

    // Privacy
    'privacy.title': 'سياسة الخصوصية',
    'privacy.s1.heading': '1. بياناتك تبقى ملكك',
    'privacy.s1.body':
      'صُمِّم مِداد للاستضافة الذاتية. عند تشغيله على بنيتك التحتية الخاصة، يبقى محتواك وبيانات مستخدميك في قاعدة بياناتك وتخزينك الكائني — لا لدينا. هذا نص مؤقت؛ استبدله بسياسة راجعها مستشارك القانوني الخاص.',
    'privacy.s2.heading': '2. ما الذي نجمعه',
    'privacy.s2.body':
      'لا يستخدم الموقع التسويقي نفسه أي تحليلات أو متعقّبات من جهات خارجية. وأي بيانات يعالجها نشر مِداد لديك تخضع لسياسة الخصوصية التي تنشرها لمستخدميك، لا لهذه الوثيقة.',
    'privacy.s3.heading': '3. التحليلات المدمجة',
    'privacy.s3.body':
      'يتضمن مِداد تحليلات داخلية (مشاهدات الصفحات والزوار الفريدون وأبرز الصفحات وعمليات البحث) تعمل بالكامل داخل عملية نشرك. ولا تُرسَل أي بيانات إلى أي مزوّد تحليلات خارجي ما لم تُهيّئ واحدًا.',
    'privacy.s4.heading': '4. ملفات تعريف الارتباط',
    'privacy.s4.body':
      'تستخدم المصادقة ملفات تعريف ارتباط للجلسة صادرة عن نشرك الخاص. وثّق ملفات تعريف الارتباط المحددة التي تُعيّنها نسختك عند تكييف هذه السياسة للإنتاج.',
    'privacy.s5.heading': '5. طلبات البيانات',
    'privacy.s5.body':
      'بما أنك تتحكم في البنية التحتية، فأنت المتحكم في البيانات لعملية نشرك. قدّم هنا بيانات التواصل الخاصة بك وإجراءاتك لمعالجة طلبات الوصول والتصحيح والحذف.',
    'privacy.s6.heading': '6. التغييرات على هذه السياسة',
    'privacy.s6.body': 'قد نُحدِّث هذه السياسة من حين لآخر. وستنعكس التغييرات الجوهرية في تاريخ «آخر تحديث» أعلاه.',
  },
} as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof (typeof messages)['en'];

const STORAGE_KEY = 'midad.www.locale';

const readStored = (): Locale => {
  if (typeof window === 'undefined') {
    return 'en';
  }
  return window.localStorage.getItem(STORAGE_KEY) === 'ar' ? 'ar' : 'en';
};

const interpolate = (template: string, vars?: Record<string, string | number>): string =>
  vars ? template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`)) : template;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * Marketing-site locale provider. The selected language drives message lookup,
 * <html lang>, and document direction (Arabic → RTL). The site SSRs in English;
 * the effect sets dir/lang on the client after mount.
 */
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStored());

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    }
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore persistence failures (private mode)
    }
  }, []);

  const t = useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => interpolate(messages[locale][key] ?? messages.en[key] ?? key, vars),
    [locale],
  );

  const value = useMemo<LocaleContextValue>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext value={value}>{children}</LocaleContext>;
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext);
  if (!ctx) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return ctx;
}

/** Convenience hook returning just the translator. */
export const useT = () => useLocale().t;
