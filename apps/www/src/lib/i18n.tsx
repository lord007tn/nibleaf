/**
 * Marketing-site UI strings (Arabic / English), keyed by dotted namespaces.
 *
 * Self-contained i18n for apps/www, mirroring the dashboard pattern. The locale
 * persists in localStorage (`nibleaf.www.locale`, default 'en') and drives the
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
    'nav.selfHost': 'Open source',
    'nav.pricing': 'Pricing',
    'nav.signIn': 'Sign in',
    'nav.getStarted': 'Get started',
    'nav.github': 'GitHub',
    'nav.githubStars': '{count} stars',
    'nav.language': 'العربية',

    // Hero
    'hero.badge': 'Nibleaf Cloud is live · open-source core',
    'hero.headlineLead': 'Beautiful docs,',
    'hero.headlineAccent': 'hosted for your team.',
    'hero.subhead':
      'Nibleaf Cloud is the managed documentation platform for teams shipping polished docs. Write in Markdown, publish a fast searchable site, connect custom domains, and track what readers need — without running servers.',
    'hero.ctaPrimary': 'Start writing',
    'hero.ctaSecondary': 'View source',
    'hero.terminal': 'docker compose up -d',
    'palette.label': 'Nibleaf brand palette',
    'hero.chip.oneCommand': 'Managed hosting',
    'hero.chip.ownData': 'Custom domains',
    'hero.chip.bilingual': 'Arabic-ready, RTL-first',
    'hero.mock.search': 'Search or ask…',
    'hero.mock.badge': 'Live preview',

    // Section eyebrows
    'eyebrow.features': 'Features',
    'eyebrow.how': 'How it works',
    'eyebrow.compare': 'Comparison',
    'eyebrow.selfHost': 'Open source',
    'eyebrow.pricing': 'Pricing',
    'eyebrow.faq': 'FAQ',

    // Trust strip
    'trust.prefix': 'Everything included',

    // How it works
    'how.heading': 'From blank page to published in minutes',
    'how.subhead': 'A calm, predictable workflow — write in Markdown, publish a versioned snapshot, share a fast site.',
    'how.step1.kicker': 'Step 1',
    'how.step1.title': 'Write in Markdown',
    'how.step1.body':
      'Author pages in a focused editor with live preview, a page tree, and MDX components. No proprietary format — your content stays portable.',
    'how.step2.kicker': 'Step 2',
    'how.step2.title': 'Publish a version',
    'how.step2.body': 'Every publish snapshots your docs and rebuilds search. Roll forward safely; readers never see a half-written page.',
    'how.step3.kicker': 'Step 3',
    'how.step3.title': 'Share your site',
    'how.step3.body': 'Connect a custom domain and ship a fast, searchable, bilingual site — hosted for you, or on your own servers.',

    // Features
    'features.heading': 'Everything you need to ship docs',
    'features.subhead': 'A managed docs workflow with the freedom of an open-source core.',
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
    'features.selfHost.title': 'Managed cloud',
    'features.selfHost.body': 'We run the app, database, storage, queues, and upgrades so your team can focus on writing and publishing.',

    // Comparison
    'compare.heading': 'A cloud docs platform without lock-in',
    'compare.subhead': 'A polished managed experience, with source-available escape hatches when you need them.',
    'compare.colNibleaf': 'Nibleaf',
    'compare.colHosted': 'Other SaaS',
    'compare.row.openSource': 'Open source',
    'compare.row.selfHost': 'Self-host on your infra',
    'compare.row.ownData': 'Own your data & storage',
    'compare.row.editor': 'Markdown editor + live preview',
    'compare.row.search': 'Built-in search',
    'compare.row.domains': 'Custom domains',
    'compare.row.noLockIn': 'No per-seat lock-in',

    // Self-host
    'selfHost.heading': 'Open source when you need it',
    'selfHost.body':
      'Nibleaf Cloud is the default hosted experience. The same core remains available for teams that need to inspect, extend, or run the platform themselves.',
    'selfHost.bullet.migrations': 'Postgres + Prisma migrations run automatically',
    'selfHost.bullet.worker': 'BullMQ worker builds & indexes your published docs',
    'selfHost.bullet.storage': 'Any S3-compatible storage (maxio, R2, S3, B2) for assets',
    'selfHost.bullet.account': 'Create your account on first run — no demo credentials in production',
    'selfHost.terminal.label': 'terminal',

    // Pricing
    'pricing.heading': 'Simple, honest pricing',
    'pricing.subhead': 'Start on Nibleaf Cloud, with the open-source edition available when you need full infrastructure control.',
    'pricing.popular': 'Popular',
    'pricing.selfHosted.name': 'Self-hosted',
    'pricing.selfHosted.price': 'Free',
    'pricing.selfHosted.tagline': 'Forever, on your own servers.',
    'pricing.selfHosted.feature.unlimited': 'Unlimited sites & pages',
    'pricing.selfHosted.feature.members': 'Unlimited members',
    'pricing.selfHosted.feature.search': 'Search, analytics, custom domains',
    'pricing.selfHosted.feature.community': 'Community support',
    'pricing.selfHosted.cta': 'Get the source',
    'pricing.cloud.name': 'Cloud',
    'pricing.cloud.price': 'Free beta',
    'pricing.cloud.tagline': 'Managed Nibleaf for teams publishing production docs.',
    'pricing.cloud.feature.everything': 'Hosted dashboard and docs sites',
    'pricing.cloud.feature.managed': 'Managed database, queues, and storage',
    'pricing.cloud.feature.upgrades': 'Automatic deploys and upgrades',
    'pricing.cloud.feature.priority': 'Custom domains and analytics',
    'pricing.cloud.cta': 'Start on Cloud',

    // FAQ
    'faq.heading': 'Frequently asked',
    'faq.free.q': 'Can I use Nibleaf Cloud now?',
    'faq.free.a': 'Yes. Nibleaf Cloud is live for teams that want managed docs hosting, sign-in, publishing, search, and custom domains.',
    'faq.selfHost.q': 'What do I need to self-host?',
    'faq.selfHost.a':
      'Docker and Docker Compose. The stack includes Postgres, a Redis-compatible cache, and S3-compatible object storage — all wired up for you.',
    'faq.storage.q': 'Can I use my own object storage?',
    'faq.storage.a': 'Absolutely. Nibleaf speaks the S3 API, so it works with maxio, Cloudflare R2, AWS S3, or Backblaze B2.',
    'faq.search.q': 'How does search work?',
    'faq.search.a': 'Every published site is indexed with Orama for full-text and fuzzy search, served directly from your API — no external service.',

    // Call to action
    'cta.heading': 'Ship docs your users will love',
    'cta.body': 'Start on Nibleaf Cloud today, then keep the open-source core in reach when you need deeper control.',
    'cta.primary': 'Get started free',
    'cta.secondary': 'View on GitHub',

    // Footer
    'footer.tagline': '— open-source docs',
    'footer.github': 'GitHub',
    'footer.dashboard': 'Dashboard',
    'footer.terms': 'Terms',
    'footer.privacy': 'Privacy',
    'footer.license': 'AGPL-3.0 licensed',
    'footer.blurb': 'Managed documentation hosting with an open-source core.',
    'footer.status': 'Nibleaf Cloud is live',
    'footer.col.product': 'Product',
    'footer.col.resources': 'Resources',
    'footer.col.legal': 'Legal',
    'footer.copyright': '© 2026 Nibleaf · AGPL-3.0',
    'footer.builtWith': 'Built with Nibleaf',

    // Marketing chrome
    'nav.cloud': 'Cloud',
    'nav.switchLanguage': 'Switch language to Arabic',
    'nav.skipToContent': 'Skip to content',
    'banner.cloud': 'Nibleaf Cloud is live on nibleaf.com.',
    'banner.cloudCta': 'Start writing',
    'banner.ariaLabel': 'Start on Nibleaf Cloud',

    // Self-hosting page
    'selfhost.eyebrow': 'Self-host',
    'selfhost.title': 'Run Nibleaf on your own infrastructure',
    'selfhost.lead':
      "One Docker command brings up the whole stack — app, API, worker, database, cache, and object storage. Your content and your users' data never leave your servers.",
    'selfhost.req.heading': 'What you need',
    'selfhost.req.sub': 'A single host with Docker. Nibleaf ships everything else.',
    'selfhost.req.docker.title': 'Docker & Compose',
    'selfhost.req.docker.body': 'Any Linux host, VPS, or homelab that runs Docker Compose.',
    'selfhost.req.db.title': 'PostgreSQL',
    'selfhost.req.db.body': 'Bundled by default, or bring your own managed Postgres.',
    'selfhost.req.cache.title': 'Redis-compatible cache',
    'selfhost.req.cache.body': 'Powers the publish queue and background jobs.',
    'selfhost.req.storage.title': 'S3-compatible storage',
    'selfhost.req.storage.body': 'For images and assets — maxio, R2, S3, or Backblaze B2.',
    'selfhost.steps.heading': 'From clone to live in four steps',
    'selfhost.step.clone.title': 'Clone the repository',
    'selfhost.step.clone.body': 'Grab the source from GitHub.',
    'selfhost.step.env.title': 'Configure your environment',
    'selfhost.step.env.body': 'Copy .env.example to .env and set your domain and secrets.',
    'selfhost.step.up.title': 'Bring up the stack',
    'selfhost.step.up.body': 'One command starts every service and runs database migrations.',
    'selfhost.step.account.title': 'Create your account',
    'selfhost.step.account.body': 'Open the app and create the first owner account — no demo credentials in production.',
    'selfhost.get.heading': 'Everything included, nothing locked away',
    'selfhost.get.b1': 'Unlimited sites, pages, and team members',
    'selfhost.get.b2': 'Built-in search, analytics, and custom domains',
    'selfhost.get.b3': 'Automatic database migrations on every release',
    'selfhost.get.b4': 'Bilingual (English + Arabic) authoring with full RTL',
    'selfhost.deploy.heading': 'Deploy your way',
    'selfhost.deploy.compose.title': 'Docker Compose',
    'selfhost.deploy.compose.body': 'The reference setup — copy the compose file and go.',
    'selfhost.deploy.coolify.title': 'Coolify',
    'selfhost.deploy.coolify.body': 'One-click self-hosting with a ready-made config.',
    'selfhost.deploy.manual.title': 'Your own orchestrator',
    'selfhost.deploy.manual.body': 'Plain containers for Kubernetes, Nomad, or bare metal.',
    'selfhost.cta.title': 'Ready to run your own docs platform?',
    'selfhost.cta.body': 'Clone the repo and be live in minutes.',
    'selfhost.cta.primary': 'Get the source',
    'selfhost.cta.secondary': 'Read the docs',

    // Cloud page
    'cloud.eyebrow': 'Nibleaf Cloud',
    'cloud.title': 'Managed Nibleaf for production docs',
    'cloud.lead':
      'Nibleaf Cloud gives your team the full docs workflow without the operations work: hosted dashboard, managed database and storage, automatic upgrades, custom domains, analytics, and Arabic-ready authoring.',
    'cloud.badge': 'Live now',
    'cloud.form.placeholder': 'you@company.com',
    'cloud.form.submit': 'Start on Cloud',
    'cloud.form.note': 'Create a workspace, write in Markdown, and publish your first docs site from nibleaf.com.',
    'cloud.form.thanks': "You're ready to start on Nibleaf Cloud.",
    'cloud.form.submitting': 'Joining…',
    'cloud.form.error': 'Something went wrong — please try again.',
    'cloud.feature.managed.title': 'Fully managed',
    'cloud.feature.managed.body': 'We run the database, cache, storage, and upgrades. You just write docs.',
    'cloud.feature.scale.title': 'Scales with you',
    'cloud.feature.scale.body': 'From one site to hundreds, without touching infrastructure.',
    'cloud.feature.same.title': 'The same Nibleaf',
    'cloud.feature.same.body': 'Identical editor, search, analytics, and Arabic-ready authoring.',
    'cloud.selfhost.title': 'Need full control?',
    'cloud.selfhost.body': 'The open-source edition remains available for teams that need to run Nibleaf inside their own infrastructure.',
    'cloud.selfhost.cta': 'Explore self-hosting',

    // About page
    'about.eyebrow': 'About',
    'about.title': 'Documentation you own, in every language',
    'about.lead':
      'Nibleaf is an open-source documentation platform for teams who want a beautiful, fast docs site — without handing their content, or their readers, to someone else.',
    'about.mission.heading': 'Why Nibleaf exists',
    'about.mission.p1':
      "Great docs tooling had become something you rent. Your content, search index, analytics, and readers all lived on someone else's servers, behind a per-seat bill. Nibleaf is the alternative: the same polished authoring experience, open source and yours to run.",
    'about.mission.p2':
      'It was built Arabic-first — full right-to-left support and bilingual authoring are core, not an afterthought — so teams working across English and Arabic get a first-class experience in both.',
    'about.values.heading': 'What we stand for',
    'about.value.open.title': 'Open source',
    'about.value.open.body': 'AGPL-3.0, developed in the open. Read it, fork it, extend it.',
    'about.value.own.title': 'You own everything',
    'about.value.own.body': "Your content and your readers' data live in your database and storage.",
    'about.value.bilingual.title': 'Bilingual by design',
    'about.value.bilingual.body': 'English and Arabic with full RTL — first-class, not bolted on.',
    'about.value.selfhost.title': 'Cloud first, source open',
    'about.value.selfhost.body': 'Use the managed cloud by default, or inspect and run the core yourself when the project requires it.',
    'about.stack.heading': 'Built on a stack you can trust',
    'about.stack.body':
      'Postgres, Hono, TanStack Start, BullMQ, Orama search, and S3-compatible storage — modern, boring-in-a-good-way infrastructure you can run yourself.',
    'about.cta.title': 'Start writing today',
    'about.cta.body': 'Start on Nibleaf Cloud, or explore the open-source edition.',

    // Legal — shared
    'legal.back': 'Back to home',
    'legal.lastUpdated': 'Last updated: {date}',

    // Terms
    'terms.title': 'Terms of Service',
    'terms.s1.heading': '1. Acceptance of terms',
    'terms.s1.body':
      'By accessing or using Nibleaf Cloud or the Nibleaf open-source edition (the "Service") you agree to be bound by these Terms of Service. If you do not agree to these terms, do not use the Service. Teams running their own deployment should review and adapt these terms with their own legal counsel.',
    'terms.s2.heading': '2. The open-source license',
    'terms.s2.body':
      "Nibleaf is distributed under the GNU Affero General Public License v3.0 (AGPL-3.0). The license that ships with the source code governs your rights to use, copy, modify, and distribute the software, and — under the AGPL's network-use clause — to receive the corresponding source of any modified version offered to you over a network. Nothing in these terms limits the rights granted to you under that open-source license.",
    'terms.s3.heading': '3. Cloud and open-source deployments',
    'terms.s3.body':
      'For Nibleaf Cloud, your workspace content, account data, and published sites are processed to provide the hosted service. When you run the open-source edition yourself, you are responsible for your own infrastructure, configuration, data, security, and compliance.',
    'terms.s4.heading': '4. Acceptable use',
    'terms.s4.body':
      'You agree not to use the Service to violate any law, infringe the rights of others, or distribute unlawful, harmful, or malicious content.',
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
      "For Nibleaf Cloud, your content and account data are used to provide hosting, publishing, search, analytics, authentication, and support. If you run the open-source edition on your own infrastructure, your deployment's data lives in the systems you operate.",
    'privacy.s2.heading': '2. What we collect',
    'privacy.s2.body':
      'We collect the information needed to operate Nibleaf Cloud, including account details, workspace metadata, project content, published-site analytics, and support communications. Public marketing pages should avoid third-party trackers unless explicitly configured.',
    'privacy.s3.heading': '3. Built-in analytics',
    'privacy.s3.body':
      'Nibleaf includes first-party analytics such as page views, unique visitors, top pages, and searches. These analytics power the product experience and do not require a third-party analytics provider.',
    'privacy.s4.heading': '4. Cookies',
    'privacy.s4.body': 'Authentication uses first-party session cookies and related security cookies to keep you signed in and protect your account.',
    'privacy.s5.heading': '5. Data requests',
    'privacy.s5.body':
      'Contact Nibleaf support for access, correction, export, or deletion requests for Cloud data. If you run the open-source edition yourself, publish your own request process for your users.',
    'privacy.s6.heading': '6. Changes to this policy',
    'privacy.s6.body': 'We may update this policy from time to time. Material changes will be reflected by the "last updated" date above.',
  },
  ar: {
    // Nav
    'nav.features': 'المزايا',
    'nav.compare': 'مقارنةً بـ Mintlify',
    'nav.selfHost': 'المصدر المفتوح',
    'nav.pricing': 'الأسعار',
    'nav.signIn': 'تسجيل الدخول',
    'nav.getStarted': 'ابدأ الآن',
    'nav.github': 'GitHub',
    'nav.githubStars': '{count} نجوم',
    'nav.language': 'EN',

    // Hero
    'hero.badge': 'Nibleaf Cloud متاح الآن · النواة مفتوحة المصدر',
    'hero.headlineLead': 'توثيق أنيق،',
    'hero.headlineAccent': 'مستضاف لفريقك.',
    'hero.subhead':
      'Nibleaf Cloud منصة توثيق مُدارة للفرق التي تنشر توثيقًا مصقولًا. اكتب بصيغة Markdown، وانشر موقعًا سريعًا قابلًا للبحث، واربط نطاقاتك المخصصة، وتابع احتياجات القراء — بدون إدارة خوادم.',
    'hero.ctaPrimary': 'ابدأ الكتابة',
    'hero.ctaSecondary': 'اعرض المصدر',
    'hero.terminal': 'docker compose up -d',
    'palette.label': 'لوحة ألوان Nibleaf',
    'hero.chip.oneCommand': 'استضافة مُدارة',
    'hero.chip.ownData': 'نطاقات مخصصة',
    'hero.chip.bilingual': 'جاهز للعربية ويدعم RTL',
    'hero.mock.search': 'ابحث أو اسأل…',
    'hero.mock.badge': 'معاينة حية',

    // Section eyebrows
    'eyebrow.features': 'المزايا',
    'eyebrow.how': 'كيف يعمل',
    'eyebrow.compare': 'المقارنة',
    'eyebrow.selfHost': 'المصدر المفتوح',
    'eyebrow.pricing': 'الأسعار',
    'eyebrow.faq': 'الأسئلة الشائعة',

    // Trust strip
    'trust.prefix': 'كل شيء مُضمَّن',

    // How it works
    'how.heading': 'من صفحة فارغة إلى موقع منشور خلال دقائق',
    'how.subhead': 'سير عمل هادئ ومتوقّع — اكتب بصيغة Markdown، وانشر لقطة موثّقة بالإصدار، وشارك موقعًا سريعًا.',
    'how.step1.kicker': 'الخطوة ١',
    'how.step1.title': 'اكتب بصيغة Markdown',
    'how.step1.body': 'ألّف صفحاتك في محرّر مُركّز مع معاينة حية وشجرة صفحات ومكوّنات MDX. بلا صيغة احتكارية — يبقى محتواك قابلًا للنقل.',
    'how.step2.kicker': 'الخطوة ٢',
    'how.step2.title': 'انشر إصدارًا',
    'how.step2.body': 'كل عملية نشر تلتقط لقطة من توثيقك وتعيد بناء الفهرس. تقدّم بأمان؛ ولن يرى القرّاء صفحة غير مكتملة أبدًا.',
    'how.step3.kicker': 'الخطوة ٣',
    'how.step3.title': 'شارك موقعك',
    'how.step3.body': 'اربط نطاقًا مخصصًا وانشر موقعًا سريعًا قابلًا للبحث وثنائي اللغة — مُستضافًا لك، أو على خوادمك الخاصة.',

    // Features
    'features.heading': 'كل ما تحتاجه لنشر توثيقك',
    'features.subhead': 'سير عمل توثيق مُدار يحافظ على سرعة التحرير والنشر والبحث.',
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
    'features.selfHost.title': 'سحابة مُدارة',
    'features.selfHost.body': 'نحن ندير التطبيق وقاعدة البيانات والتخزين والترقيات، بينما تبقى النواة مفتوحة المصدر للفرق التي تحتاج إلى تحكم أعمق.',

    // Comparison
    'compare.heading': 'منصة توثيق سحابية بلا احتكار',
    'compare.subhead': 'تجربة مُدارة مصقولة مع نواة مفتوحة المصدر عندما تحتاج إلى المرونة.',
    'compare.colNibleaf': 'Nibleaf',
    'compare.colHosted': 'SaaS آخر',
    'compare.row.openSource': 'مفتوح المصدر',
    'compare.row.selfHost': 'استضافة ذاتية على بنيتك التحتية',
    'compare.row.ownData': 'ملكية بياناتك وتخزينك',
    'compare.row.editor': 'محرّر Markdown مع معاينة حية',
    'compare.row.search': 'بحث مدمج',
    'compare.row.domains': 'نطاقات مخصصة',
    'compare.row.noLockIn': 'بلا احتكار حسب المقعد',

    // Self-host
    'selfHost.heading': 'النواة مفتوحة المصدر عندما تحتاجها',
    'selfHost.body':
      'Nibleaf Cloud هي التجربة المُستضافة الافتراضية. وتبقى النواة نفسها متاحة للفرق التي تحتاج إلى فحص المنصة أو توسيعها أو تشغيلها بنفسها.',
    'selfHost.bullet.migrations': 'ترحيلات Postgres وPrisma تُنفَّذ تلقائيًا',
    'selfHost.bullet.worker': 'عامل BullMQ يبني توثيقك المنشور ويفهرسه',
    'selfHost.bullet.storage': 'أي تخزين متوافق مع S3 (maxio أو R2 أو S3 أو B2) للأصول',
    'selfHost.bullet.account': 'أنشئ حسابك عند أول تشغيل — بلا بيانات اعتماد تجريبية في الإنتاج',
    'selfHost.terminal.label': 'الطرفية',

    // Pricing
    'pricing.heading': 'تسعير بسيط وصادق',
    'pricing.subhead': 'ابدأ على Nibleaf Cloud، مع النسخة مفتوحة المصدر عندما تحتاج إلى تحكم كامل في البنية التحتية.',
    'pricing.popular': 'الأكثر شيوعًا',
    'pricing.selfHosted.name': 'الاستضافة الذاتية',
    'pricing.selfHosted.price': 'مجانًا',
    'pricing.selfHosted.tagline': 'إلى الأبد، على خوادمك الخاصة.',
    'pricing.selfHosted.feature.unlimited': 'مواقع وصفحات بلا حدود',
    'pricing.selfHosted.feature.members': 'أعضاء بلا حدود',
    'pricing.selfHosted.feature.search': 'بحث وتحليلات ونطاقات مخصصة',
    'pricing.selfHosted.feature.community': 'دعم المجتمع',
    'pricing.selfHosted.cta': 'احصل على المصدر',
    'pricing.cloud.name': 'Cloud',
    'pricing.cloud.price': 'بيتا مجانية',
    'pricing.cloud.tagline': 'Nibleaf مُدار للفرق التي تنشر توثيق إنتاجي.',
    'pricing.cloud.feature.everything': 'لوحة تحكم ومواقع توثيق مُستضافة',
    'pricing.cloud.feature.managed': 'قاعدة بيانات وطوابير وتخزين مُدار',
    'pricing.cloud.feature.upgrades': 'نشر وترقيات تلقائية',
    'pricing.cloud.feature.priority': 'نطاقات مخصصة وتحليلات',
    'pricing.cloud.cta': 'ابدأ على Cloud',

    // FAQ
    'faq.heading': 'الأسئلة الشائعة',
    'faq.free.q': 'هل يمكنني استخدام Nibleaf Cloud الآن؟',
    'faq.free.a': 'نعم. Nibleaf Cloud متاح للفرق التي تريد استضافة توثيق مُدارة وتسجيل دخول ونشرًا وبحثًا ونطاقات مخصصة.',
    'faq.selfHost.q': 'ما الذي أحتاجه للاستضافة الذاتية؟',
    'faq.selfHost.a':
      'Docker وDocker Compose. تتضمن الحزمة Postgres وذاكرة تخزين مؤقت متوافقة مع Redis وتخزينًا كائنيًا متوافقًا مع S3 — كلها مُهيّأة لك مسبقًا.',
    'faq.storage.q': 'هل يمكنني استخدام تخزيني الكائني الخاص؟',
    'faq.storage.a': 'بالتأكيد. يدعم Nibleaf واجهة S3، لذا يعمل مع maxio أو Cloudflare R2 أو AWS S3 أو Backblaze B2.',
    'faq.search.q': 'كيف يعمل البحث؟',
    'faq.search.a': 'يُفهرَس كل موقع منشور باستخدام Orama لبحث نصي كامل وتقريبي، يُقدَّم مباشرةً من واجهة API الخاصة بك — بلا خدمة خارجية.',

    // Call to action
    'cta.heading': 'انشر توثيقًا سيحبه مستخدموك',
    'cta.body': 'ابدأ على Nibleaf Cloud اليوم، واحتفظ بالنواة مفتوحة المصدر عندما تحتاج إلى تحكم أعمق.',
    'cta.primary': 'ابدأ مجانًا',
    'cta.secondary': 'استعرض على GitHub',

    // Footer
    'footer.tagline': '— توثيق مفتوح المصدر',
    'footer.github': 'GitHub',
    'footer.dashboard': 'لوحة التحكم',
    'footer.terms': 'الشروط',
    'footer.privacy': 'الخصوصية',
    'footer.license': 'مُرخّص بـ AGPL-3.0',
    'footer.blurb': 'استضافة توثيق مُدارة مع نواة مفتوحة المصدر.',
    'footer.status': 'Nibleaf Cloud متاح الآن',
    'footer.col.product': 'المنتج',
    'footer.col.resources': 'المصادر',
    'footer.col.legal': 'قانوني',
    'footer.copyright': '© 2026 Nibleaf · AGPL-3.0',
    'footer.builtWith': 'صُنع بـ Nibleaf',

    // Marketing chrome
    'nav.cloud': 'السحابة',
    'nav.switchLanguage': 'Switch language to English',
    'nav.skipToContent': 'تخطَّ إلى المحتوى',
    'banner.cloud': 'Nibleaf Cloud متاح الآن على nibleaf.com.',
    'banner.cloudCta': 'ابدأ الكتابة',
    'banner.ariaLabel': 'ابدأ على Nibleaf Cloud',

    // Self-hosting page
    'selfhost.eyebrow': 'الاستضافة الذاتية',
    'selfhost.title': 'شغّل Nibleaf على بنيتك التحتية الخاصة',
    'selfhost.lead':
      'أمر Docker واحد يشغّل الحزمة بالكامل — التطبيق وواجهة API والعامل وقاعدة البيانات والذاكرة المؤقتة والتخزين الكائني. محتواك وبيانات مستخدميك لا تغادر خوادمك أبدًا.',
    'selfhost.req.heading': 'ما الذي تحتاجه',
    'selfhost.req.sub': 'خادم واحد مزوّد بـ Docker. وNibleaf يوفّر كل شيء آخر.',
    'selfhost.req.docker.title': 'Docker و Compose',
    'selfhost.req.docker.body': 'أي خادم Linux أو VPS أو مختبر منزلي يشغّل Docker Compose.',
    'selfhost.req.db.title': 'PostgreSQL',
    'selfhost.req.db.body': 'مضمّن افتراضيًا، أو استخدم Postgres المُدار الخاص بك.',
    'selfhost.req.cache.title': 'ذاكرة متوافقة مع Redis',
    'selfhost.req.cache.body': 'تشغّل طابور النشر والمهام في الخلفية.',
    'selfhost.req.storage.title': 'تخزين متوافق مع S3',
    'selfhost.req.storage.body': 'للصور والأصول — maxio أو R2 أو S3 أو Backblaze B2.',
    'selfhost.steps.heading': 'من الاستنساخ إلى التشغيل في أربع خطوات',
    'selfhost.step.clone.title': 'استنسخ المستودع',
    'selfhost.step.clone.body': 'احصل على الشيفرة المصدرية من GitHub.',
    'selfhost.step.env.title': 'هيّئ بيئتك',
    'selfhost.step.env.body': 'انسخ .env.example إلى .env واضبط نطاقك ومفاتيحك السرية.',
    'selfhost.step.up.title': 'شغّل الحزمة',
    'selfhost.step.up.body': 'أمر واحد يشغّل كل الخدمات ويطبّق ترحيلات قاعدة البيانات.',
    'selfhost.step.account.title': 'أنشئ حسابك',
    'selfhost.step.account.body': 'افتح التطبيق وأنشئ حساب المالك الأول — بلا بيانات اعتماد تجريبية في الإنتاج.',
    'selfhost.get.heading': 'كل شيء مُضمَّن، ولا شيء محتكَر',
    'selfhost.get.b1': 'مواقع وصفحات وأعضاء فريق بلا حدود',
    'selfhost.get.b2': 'بحث وتحليلات ونطاقات مخصصة مدمجة',
    'selfhost.get.b3': 'ترحيلات تلقائية لقاعدة البيانات مع كل إصدار',
    'selfhost.get.b4': 'تأليف ثنائي اللغة (عربي + إنجليزي) مع دعم كامل لـ RTL',
    'selfhost.deploy.heading': 'انشر بطريقتك',
    'selfhost.deploy.compose.title': 'Docker Compose',
    'selfhost.deploy.compose.body': 'الإعداد المرجعي — انسخ ملف compose وابدأ.',
    'selfhost.deploy.coolify.title': 'Coolify',
    'selfhost.deploy.coolify.body': 'استضافة ذاتية بنقرة واحدة مع إعداد جاهز.',
    'selfhost.deploy.manual.title': 'منسّقك الخاص',
    'selfhost.deploy.manual.body': 'حاويات بسيطة لـ Kubernetes أو Nomad أو الخوادم الفعلية.',
    'selfhost.cta.title': 'جاهز لتشغيل منصة التوثيق الخاصة بك؟',
    'selfhost.cta.body': 'استنسخ المستودع وكن على الهواء خلال دقائق.',
    'selfhost.cta.primary': 'احصل على المصدر',
    'selfhost.cta.secondary': 'اقرأ التوثيق',

    // Cloud page
    'cloud.eyebrow': 'Nibleaf السحابي',
    'cloud.title': 'Nibleaf مُدار لتوثيق الإنتاج',
    'cloud.lead':
      'Nibleaf Cloud يمنح فريقك سير عمل التوثيق كاملًا بدون عمل التشغيل: لوحة تحكم مُستضافة، وقاعدة بيانات وتخزين مُداران، وترقيات تلقائية، ونطاقات مخصصة، وتحليلات، وتأليف جاهز للعربية.',
    'cloud.badge': 'متاح الآن',
    'cloud.form.placeholder': 'you@company.com',
    'cloud.form.submit': 'ابدأ على Cloud',
    'cloud.form.note': 'أنشئ مساحة عمل وابدأ النشر على nibleaf.com.',
    'cloud.form.thanks': 'أنت جاهز للبدء على Nibleaf Cloud.',
    'cloud.form.submitting': 'جارٍ الانضمام…',
    'cloud.form.error': 'حدث خطأ ما — يرجى المحاولة مرة أخرى.',
    'cloud.feature.managed.title': 'مُدار بالكامل',
    'cloud.feature.managed.body': 'نحن ندير قاعدة البيانات والذاكرة والتخزين والترقيات. وأنت تكتب توثيقك فقط.',
    'cloud.feature.scale.title': 'يتوسّع معك',
    'cloud.feature.scale.body': 'من موقع واحد إلى المئات، بلا لمس البنية التحتية.',
    'cloud.feature.same.title': 'Nibleaf نفسه',
    'cloud.feature.same.body': 'المحرّر والبحث والتحليلات والتأليف الجاهز للعربية — كلها نفسها.',
    'cloud.selfhost.title': 'تحتاج إلى تحكم كامل؟',
    'cloud.selfhost.body': 'تبقى النسخة مفتوحة المصدر متاحة للفرق التي تريد تشغيل Nibleaf على بنيتها الخاصة.',
    'cloud.selfhost.cta': 'استكشف الاستضافة الذاتية',

    // About page
    'about.eyebrow': 'من نحن',
    'about.title': 'توثيق تملكه، وبكل لغة',
    'about.lead': 'Nibleaf منصة توثيق مفتوحة المصدر للفرق التي تريد موقع توثيق أنيقًا وسريعًا — دون تسليم محتواها أو قرّائها لطرف آخر.',
    'about.mission.heading': 'لماذا وُجد Nibleaf',
    'about.mission.p1':
      'أصبحت أدوات التوثيق الرائعة شيئًا تستأجره. محتواك وفهرس بحثك وتحليلاتك وقرّاؤك جميعهم على خوادم غيرك، خلف فاتورة لكل مقعد. Nibleaf هو البديل: تجربة التأليف المتقنة نفسها، مفتوحة المصدر وملكك لتشغيلها.',
    'about.mission.p2':
      'بُني Nibleaf بالعربية أولًا — دعم كامل للكتابة من اليمين إلى اليسار وتأليف ثنائي اللغة في صميمه لا كإضافة لاحقة — لتحصل الفرق العاملة بالعربية والإنجليزية على تجربة من الطراز الأول باللغتين.',
    'about.values.heading': 'بماذا نؤمن',
    'about.value.open.title': 'مفتوح المصدر',
    'about.value.open.body': 'برخصة AGPL-3.0 ويُطوَّر علنًا. اقرأه وفرّعه ووسّعه.',
    'about.value.own.title': 'أنت تملك كل شيء',
    'about.value.own.body': 'محتواك وبيانات قرّائك تبقى في قاعدة بياناتك وتخزينك.',
    'about.value.bilingual.title': 'ثنائي اللغة بالتصميم',
    'about.value.bilingual.body': 'الإنجليزية والعربية مع دعم كامل لـ RTL — أصيل لا مُضاف.',
    'about.value.selfhost.title': 'السحابة أولًا، والمصدر مفتوح',
    'about.value.selfhost.body': 'استخدم السحابة المُدارة افتراضيًا، وافحص النواة أو شغّلها بنفسك عند الحاجة.',
    'about.stack.heading': 'مبني على حزمة تقنية تثق بها',
    'about.stack.body': 'Postgres وHono وTanStack Start وBullMQ وبحث Orama وتخزين متوافق مع S3 — بنية تحتية حديثة وموثوقة يمكنك تشغيلها بنفسك.',
    'about.cta.title': 'ابدأ الكتابة اليوم',
    'about.cta.body': 'ابدأ على Nibleaf Cloud، أو استكشف النسخة مفتوحة المصدر.',

    // Legal — shared
    'legal.back': 'العودة إلى الرئيسية',
    'legal.lastUpdated': 'آخر تحديث: {date}',

    // Terms
    'terms.title': 'شروط الخدمة',
    'terms.s1.heading': '1. قبول الشروط',
    'terms.s1.body':
      'باستخدامك Nibleaf Cloud أو نسخة Nibleaf مفتوحة المصدر («الخدمة») أو الوصول إليها، فإنك توافق على الالتزام بشروط الخدمة هذه. إذا لم توافق على هذه الشروط، فلا تستخدم الخدمة. وينبغي على الفرق التي تشغّل نشرها الخاص مراجعة هذه الشروط وتكييفها بالاستعانة بمستشارها القانوني.',
    'terms.s2.heading': '2. رخصة المصدر المفتوح',
    'terms.s2.body':
      'يُوزَّع Nibleaf بموجب رخصة جنو العمومية العامة أفيرو الإصدار 3.0 (AGPL-3.0). الرخصة المرفقة مع الشيفرة المصدرية تحكم حقوقك في استخدام البرنامج ونسخه وتعديله وتوزيعه، وكذلك — بموجب بند الاستخدام الشبكي في AGPL — في الحصول على الشيفرة المصدرية المقابلة لأي نسخة معدّلة تُقدَّم إليك عبر الشبكة. ولا يحدّ أي بند في هذه الشروط من الحقوق الممنوحة لك بموجب تلك الرخصة مفتوحة المصدر.',
    'terms.s3.heading': '3. النشر السحابي ومفتوح المصدر',
    'terms.s3.body':
      'في Nibleaf Cloud، نعالج محتوى مساحة عملك وبيانات حسابك ومواقعك المنشورة لتقديم الخدمة المستضافة. وعند تشغيل النسخة مفتوحة المصدر بنفسك، تتحمل مسؤولية بنيتك التحتية وإعداداتك وبياناتك وأمنك والامتثال للأنظمة.',
    'terms.s4.heading': '4. الاستخدام المقبول',
    'terms.s4.body': 'توافق على عدم استخدام الخدمة لمخالفة أي قانون أو انتهاك حقوق الآخرين أو نشر محتوى غير قانوني أو ضار أو خبيث.',
    'terms.s5.heading': '5. تحديد المسؤولية',
    'terms.s5.body':
      'إلى أقصى حد يسمح به القانون، لا يتحمل المؤلفون وأصحاب حقوق النشر أي مسؤولية عن أي مطالبة أو أضرار أو أي مسؤولية أخرى تنشأ عن استخدام الخدمة.',
    'terms.s6.heading': '6. التغييرات على هذه الشروط',
    'terms.s6.body': 'قد نُحدِّث هذه الشروط من حين لآخر. ويُعدّ استمرار استخدامك للخدمة بعد سريان التغييرات قبولًا للشروط المُحدَّثة.',

    // Privacy
    'privacy.title': 'سياسة الخصوصية',
    'privacy.s1.heading': '1. بياناتك تبقى ملكك',
    'privacy.s1.body':
      'في Nibleaf Cloud، نستخدم محتواك وبيانات حسابك لتقديم الاستضافة والنشر والبحث والتحليلات والمصادقة والدعم. وإذا شغّلت النسخة مفتوحة المصدر على بنيتك الخاصة، فتبقى بيانات ذلك النشر في الأنظمة التي تديرها.',
    'privacy.s2.heading': '2. ما الذي نجمعه',
    'privacy.s2.body':
      'نجمع المعلومات اللازمة لتشغيل Nibleaf Cloud، بما في ذلك تفاصيل الحساب وبيانات مساحة العمل ومحتوى المشاريع وتحليلات المواقع المنشورة ومراسلات الدعم. وينبغي ألا تستخدم صفحات التسويق العامة متعقبات خارجية ما لم تُهيّأ صراحة.',
    'privacy.s3.heading': '3. التحليلات المدمجة',
    'privacy.s3.body':
      'يتضمن Nibleaf تحليلات داخلية مثل مشاهدات الصفحات والزوار الفريدين وأبرز الصفحات وعمليات البحث. تدعم هذه التحليلات تجربة المنتج ولا تتطلب مزوّد تحليلات خارجيًا.',
    'privacy.s4.heading': '4. ملفات تعريف الارتباط',
    'privacy.s4.body': 'تستخدم المصادقة ملفات تعريف ارتباط للجلسة وملفات أمان ذات صلة لإبقائك مسجّل الدخول وحماية حسابك.',
    'privacy.s5.heading': '5. طلبات البيانات',
    'privacy.s5.body':
      'تواصل مع دعم Nibleaf لطلبات الوصول أو التصحيح أو التصدير أو الحذف الخاصة ببيانات Cloud. وإذا شغّلت النسخة مفتوحة المصدر بنفسك، فانشر إجراءاتك الخاصة لمستخدميك.',
    'privacy.s6.heading': '6. التغييرات على هذه السياسة',
    'privacy.s6.body': 'قد نُحدِّث هذه السياسة من حين لآخر. وستنعكس التغييرات الجوهرية في تاريخ «آخر تحديث» أعلاه.',
  },
} as const;

export type Locale = keyof typeof messages;
export type MessageKey = keyof (typeof messages)['en'];

const STORAGE_KEY = 'nibleaf.www.locale';

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
