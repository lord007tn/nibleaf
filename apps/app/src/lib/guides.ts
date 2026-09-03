export type GuideLocale = 'ar' | 'en';

export interface GuidePillar {
  id: string;
  en: string;
  ar: string;
}

export interface GuideEntry {
  id: string;
  pillar: GuidePillar['id'];
  job: 'choose' | 'design' | 'migrate' | 'operate' | 'publish';
  featured?: boolean;
  language: 'bilingual' | 'en';
  href: Record<GuideLocale, string>;
  title: Record<GuideLocale, string>;
  summary: Record<GuideLocale, string>;
  next: Record<GuideLocale, string>;
}

export const GUIDE_PILLARS: GuidePillar[] = [
  { id: 'platforms', en: 'Choose a docs platform', ar: 'اختيار منصة التوثيق' },
  { id: 'ownership', en: 'Visual authoring & Markdown ownership', ar: 'التأليف المرئي وملكية Markdown' },
  { id: 'migration', en: 'Migration', ar: 'الترحيل' },
  { id: 'arabic', en: 'Arabic & RTL', ar: 'العربية وRTL' },
  { id: 'operations', en: 'Self-hosting & operations', ar: 'الاستضافة الذاتية والعمليات' },
  { id: 'ai', en: 'Search & AI', ar: 'البحث والذكاء الاصطناعي' },
  { id: 'governance', en: 'Security & governance', ar: 'الأمان والحوكمة' },
  { id: 'publishing', en: 'Publishing & troubleshooting', ar: 'النشر واستكشاف الأعطال' },
];

export const GUIDES: GuideEntry[] = [
  {
    id: 'platform-or-generator',
    pillar: 'platforms',
    job: 'choose',
    featured: true,
    language: 'en',
    href: { en: '/blog/open-source-documentation-tools', ar: '/blog/open-source-documentation-tools' },
    title: { en: 'Documentation platform or static-site generator?', ar: 'منصة توثيق أم مولّد موقع ثابت؟' },
    summary: {
      en: 'Choose from collaboration, ownership, operations, and release constraints—not a feature-count table.',
      ar: 'اختر وفق التعاون والملكية والعمليات وقيود الإصدار، لا وفق عدد الميزات. الدليل الكامل متاح بالإنجليزية.',
    },
    next: { en: 'Then test the authoring workflow with representative content.', ar: 'ثم اختبر سير التأليف بمحتوى ممثل.' },
  },
  {
    id: 'visual-markdown',
    pillar: 'ownership',
    job: 'design',
    featured: true,
    language: 'en',
    href: { en: '/blog/docs-should-live-in-plain-markdown', ar: '/blog/docs-should-live-in-plain-markdown' },
    title: { en: 'Run a visual-editor + Markdown workflow', ar: 'تشغيل محرر مرئي مع سير Markdown' },
    summary: {
      en: 'Define the source of truth, review boundary, round-trip test, and escape hatch before selecting an editor.',
      ar: 'حدّد مصدر الحقيقة وحدود المراجعة واختبار الذهاب والعودة ومسار الخروج قبل اختيار المحرر. الدليل بالإنجليزية.',
    },
    next: { en: 'Use the deterministic round-trip fixture in your editor.', ar: 'استخدم عينة الذهاب والعودة الحتمية في محررك.' },
  },
  {
    id: 'production-readiness',
    pillar: 'governance',
    job: 'choose',
    featured: true,
    language: 'en',
    href: { en: '/blog/documentation-production-readiness-decision', ar: '/blog/documentation-production-readiness-decision' },
    title: { en: 'Decide whether a docs stack is production-ready', ar: 'تحديد جاهزية منظومة التوثيق للإنتاج' },
    summary: {
      en: 'A go/no-go record for release identity, recovery, access, observability, search, and content ownership.',
      ar: 'سجل قرار يختبر هوية الإصدار والتعافي والوصول والمراقبة والبحث وملكية المحتوى. الدليل بالإنجليزية.',
    },
    next: { en: 'Turn every unknown into an owner, proof, and due date.', ar: 'حوّل كل مجهول إلى مالك ودليل وتاريخ استحقاق.' },
  },
  {
    id: 'migration-cutover',
    pillar: 'migration',
    job: 'migrate',
    language: 'en',
    href: { en: '/blog/documentation-migration-seo-cutover-lab', ar: '/blog/documentation-migration-seo-cutover-lab' },
    title: { en: 'Test a documentation migration and SEO cutover', ar: 'اختبار ترحيل التوثيق وتحويل SEO' },
    summary: {
      en: 'Inventory URLs, rehearse redirects, compare rendered pages, freeze writes, cut over, and keep a rollback trigger.',
      ar: 'احصر الروابط ودرّب التحويلات وقارن الصفحات وثبّت الكتابة ونفّذ التحويل مع شرط تراجع. الدليل بالإنجليزية.',
    },
    next: { en: 'Run the included redirect-map verifier before DNS changes.', ar: 'شغّل مدقق خريطة التحويلات قبل تغيير DNS.' },
  },
  {
    id: 'information-architecture',
    pillar: 'publishing',
    job: 'design',
    language: 'en',
    href: { en: '/blog/documentation-information-architecture-collaboration', ar: '/blog/documentation-information-architecture-collaboration' },
    title: { en: 'Design information architecture and collaboration', ar: 'تصميم بنية المعلومات والتعاون' },
    summary: {
      en: 'Map reader jobs to owners, page types, review states, navigation, and a change-control rhythm.',
      ar: 'اربط مهام القارئ بالمالكين وأنواع الصفحات وحالات المراجعة والتنقل وإيقاع ضبط التغيير. الدليل بالإنجليزية.',
    },
    next: { en: 'Pilot one learning path before reorganizing the full tree.', ar: 'اختبر مسار تعلم واحدًا قبل إعادة تنظيم الشجرة كاملة.' },
  },
  {
    id: 'coolify-recovery',
    pillar: 'operations',
    job: 'operate',
    language: 'en',
    href: { en: '/blog/coolify-documentation-502-503-recovery', ar: '/blog/coolify-documentation-502-503-recovery' },
    title: { en: 'Recover a Coolify docs deployment from 502/503', ar: 'استعادة نشر توثيق على Coolify من 502/503' },
    summary: {
      en: 'Separate proxy, container, readiness, migration, dependency, and replacement-window failures before changing state.',
      ar: 'افصل أعطال الوكيل والحاوية والجاهزية والترحيل والتبعيات ونافذة الاستبدال قبل تغيير الحالة. الدليل بالإنجليزية.',
    },
    next: { en: 'Capture the first failing layer and exact image revision.', ar: 'سجّل أول طبقة فاشلة ومراجعة الصورة الدقيقة.' },
  },
  {
    id: 'resource-sizing',
    pillar: 'operations',
    job: 'operate',
    language: 'en',
    href: {
      en: '/blog/self-host-documentation-site-docker-compose#size-from-observations-not-a-guess',
      ar: '/blog/self-host-documentation-site-docker-compose#size-from-observations-not-a-guess',
    },
    title: { en: 'Size a self-hosted docs stack from evidence', ar: 'تحديد موارد منصة مستضافة ذاتيًا من الأدلة' },
    summary: {
      en: 'Measure steady state, publish peaks, search indexing, headroom, and recovery time with a reusable worksheet.',
      ar: 'قس الحالة المستقرة وذروة النشر وفهرسة البحث والهامش وزمن التعافي بورقة قابلة لإعادة الاستخدام. الدليل بالإنجليزية.',
    },
    next: { en: 'Collect seven representative days before setting limits.', ar: 'اجمع سبعة أيام ممثلة قبل تثبيت الحدود.' },
  },
  {
    id: 'arabic-evaluation',
    pillar: 'arabic',
    job: 'publish',
    language: 'bilingual',
    href: { en: '/blog/arabic-documentation-rtl', ar: '/blog/arabic-technical-documentation-rtl-checklist' },
    title: { en: 'Evaluate Arabic search and RTL behavior', ar: 'تقييم البحث العربي وسلوك RTL' },
    summary: {
      en: 'Use mixed-direction text, morphology queries, mobile navigation, fonts, and metadata fixtures instead of screenshots alone.',
      ar: 'استخدم نصًا مختلط الاتجاه واستعلامات صرفية وتنقل الهاتف والخطوط وبيانات التعريف، لا لقطات الشاشة وحدها.',
    },
    next: { en: 'Add your ten highest-value Arabic queries to the fixture.', ar: 'أضف أهم عشرة استعلامات عربية لديك إلى العينة.' },
  },
  {
    id: 'ai-ready',
    pillar: 'ai',
    job: 'publish',
    language: 'en',
    href: { en: '/blog/ai-ready-documentation', ar: '/blog/ai-ready-documentation' },
    title: { en: 'Make documentation usable by AI assistants', ar: 'جعل التوثيق قابلًا لاستخدام مساعدات الذكاء الاصطناعي' },
    summary: {
      en: 'Ship canonical HTML, equivalent Markdown, concise llms discovery, complete retrieval content, and leakage tests.',
      ar: 'انشر HTML أساسيًا وMarkdown مكافئًا واكتشاف llms موجزًا ومحتوى استرجاع كاملًا واختبارات منع التسريب. الدليل بالإنجليزية.',
    },
    next: { en: 'Probe every sitemap URL with HTML and Markdown requests.', ar: 'افحص كل رابط في خريطة الموقع بطلبَي HTML وMarkdown.' },
  },
];

export const guidePillar = (id: string): GuidePillar | undefined => GUIDE_PILLARS.find((pillar) => pillar.id === id);
