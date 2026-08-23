import type { BlogEntry } from './blog';

/** Lightweight article metadata. Keep this in sync with MDX frontmatter.
 * Article bodies remain in the lazy blog route chunk instead of the homepage. */
export const BLOG_MANIFEST = [
  {
    slug: 'choosing-documentation-template',
    title: 'How to choose a documentation template: reference, editorial, or code-first',
    metaTitle: 'How to choose a documentation template for your content',
    description:
      'A practical framework for choosing Harbor, Manuscript, or Signal based on reader intent, content shape, navigation depth, and code density.',
    datePublished: '2026-08-23',
    dateModified: '2026-08-23',
    tags: ['guide', 'templates', 'information-architecture'],
    related: ['documentation-templates-harbor-manuscript-signal', 'docs-should-live-in-plain-markdown', 'arabic-documentation-rtl'],
    readingMinutes: 7,
    faqs: [
      {
        question: 'Which Nibleaf template should a new project use?',
        answer:
          'Start with Harbor when the content mixes guides and reference material. Move to Manuscript for chapter-led reading or Signal when code and API scanning dominate the experience.',
      },
      {
        question: 'Should every section of a documentation site use a different template?',
        answer:
          'Usually not. A consistent site-level structure is easier to learn. Choose the layout that fits the dominant reader task, then use cards, tabs, callouts, and page organization for local variation.',
      },
      {
        question: 'What should I test before publishing a template change?',
        answer:
          'Review representative short and long pages, deep navigation, search, tables, code, mobile behavior, light and dark appearances, and every supported writing direction.',
      },
    ],
  },
  {
    slug: 'documentation-templates-harbor-manuscript-signal',
    title: 'Introducing Harbor, Manuscript, and Signal: three layouts for three kinds of documentation',
    metaTitle: 'New Nibleaf documentation templates: Harbor, Manuscript, and Signal',
    description:
      'Nibleaf now includes three structural documentation templates for product guides, editorial knowledge, and code-first API references.',
    datePublished: '2026-08-23',
    dateModified: '2026-08-23',
    tags: ['announcement', 'templates', 'theming'],
    related: ['choosing-documentation-template', 'docs-should-live-in-plain-markdown', 'introducing-nibleaf-open-source-mintlify-alternative'],
    readingMinutes: 6,
    faqs: [
      {
        question: 'Are Nibleaf templates only color themes?',
        answer:
          'No. Each template owns the placement and behavior of the header, navigation, content frame, page outline, and preview. Colors and component treatments remain customizable inside that structure.',
      },
      {
        question: 'Can a project switch templates without rewriting its pages?',
        answer:
          'Yes. Templates render the same portable Markdown and MDX content. Switching changes the reader structure and design tokens, not the stored page source.',
      },
      {
        question: 'Do all three templates support Arabic and RTL?',
        answer:
          'Yes. The templates use logical layout properties, flip navigation correctly for RTL, and preserve left-to-right direction for code and commands.',
      },
    ],
  },
  {
    slug: 'arabic-technical-documentation-rtl-checklist',
    title: 'كيف تنشر وثائق منتج بالعربية من دون أن تكسر RTL والبحث',
    metaTitle: 'وثائق المنتج بالعربية: قائمة فحص RTL والبحث | Nibleaf',
    description: 'قائمة فحص عملية لنشر وثائق منتج بالعربية: اتجاه الصفحة، الشيفرة داخل النص، البحث، الخطوط، شجرة الصفحات، ووسوم hreflang قبل النشر.',
    language: 'ar',
    datePublished: '2026-08-15',
    dateModified: '2026-08-19',
    tags: ['العربية', 'RTL', 'وثائق المنتج'],
    related: ['arabic-documentation-rtl', 'docs-should-live-in-plain-markdown', 'self-host-documentation-site-docker-compose'],
    translationOf: 'arabic-documentation-rtl',
    readingMinutes: 8,
    faqs: [
      {
        question: 'هل يكفي إضافة dir="rtl" إلى صفحة الوثائق؟',
        answer:
          'لا. هذا يضبط اتجاه الصفحة، لكنه لا يعزل الأوامر والمسارات داخل الفقرات العربية، ولا يقلب الأيقونات الاتجاهية، ولا يجعل البحث واعيًا باختلاف كتابة الكلمات العربية.',
      },
      {
        question: 'كيف أختبر البحث في وثائق عربية؟',
        answer:
          'ابدأ بكلمات من صفحاتك نفسها، ثم جرّبها من دون تشكيل أو تطويل وبأشكال الألف المختلفة. اختبر الكلمات ذات البوادئ واللواحق أيضًا؛ يستخدم Nibleaf تطبيعًا إملائيًا ومسارًا صرفيًا خفيفًا ومحافظًا، مع إبقاء المطابقات الدقيقة في المرتبة الأعلى.',
      },
      {
        question: 'هل يجب أن تطابق شجرة الصفحات العربية الشجرة الإنجليزية؟',
        answer:
          'لا يلزم. انشر الصفحات التي يحتاجها القارئ العربي أولًا، وحافظ على رابط واضح بين الصفحات المتقابلة فقط كي تعمل hreflang ومبدلات اللغة بصورة صحيحة.',
      },
      {
        question: 'ما الذي يدعمه Nibleaf للعربية اليوم؟',
        answer:
          'يدعم اتجاه RTL في القارئ والمحرر، وشجرة مستقلة لكل لغة، وعزل الشيفرة داخل النص، وبحثًا يستخدم tokenizer عربيًا مع تطبيع إملائي ومسار صرفي خفيف ومحافظ، إضافة إلى canonical وhreflang للصفحات المتقابلة.',
      },
    ],
  },
  {
    slug: 'gitbook-vs-mintlify',
    title: 'GitBook vs Mintlify in 2026: editor, Git workflow, pricing, and ownership',
    metaTitle: 'GitBook vs Mintlify in 2026: a practical comparison',
    description:
      'A source-backed GitBook and Mintlify comparison covering editors, Git workflows, API docs, pricing, multilingual content, and self-hosting.',
    datePublished: '2026-08-15',
    dateModified: '2026-08-17',
    tags: ['comparison', 'gitbook', 'mintlify'],
    related: ['open-source-documentation-tools', 'docs-should-live-in-plain-markdown', 'introducing-nibleaf-open-source-mintlify-alternative'],
    readingMinutes: 8,
    faqs: [
      {
        question: 'Is GitBook or Mintlify better for non-technical writers?',
        answer:
          'GitBook starts from a block editor and is usually the more direct fit for writers who do not want to work in Git. Mintlify also has a web editor, but its publishing model stays closely tied to a Git repository and branches.',
      },
      {
        question: 'Can GitBook be self-hosted?',
        answer:
          'GitBook has released its published-site renderer under GPLv3, and that renderer can be self-hosted. GitBook says this is not its recommended or supported path, and the hosted workspace and editor are not included.',
      },
      {
        question: 'Does Mintlify support a visual editor?',
        answer:
          'Yes. Mintlify’s web editor provides visual and source editing, creates Git branches for drafts, and publishes through commits and merges.',
      },
      {
        question: 'Which product is better for API documentation?',
        answer:
          'Both support API documentation. Mintlify makes generated API pages, an API playground, and OpenAPI workflows central to its product. GitBook also imports OpenAPI and provides interactive API blocks, so the better choice depends on the rest of the writing and review workflow.',
      },
    ],
  },
  {
    slug: 'arabic-documentation-rtl',
    title: 'Arabic documentation and RTL: a practical implementation guide',
    metaTitle: 'Arabic documentation and RTL: a practical guide | Nibleaf',
    description:
      'A practical guide to RTL layout, bidirectional code, Arabic search, language trees, hreflang, and typography for product documentation.',
    datePublished: '2026-07-13',
    dateModified: '2026-08-19',
    tags: ['arabic', 'rtl', 'i18n'],
    related: ['arabic-technical-documentation-rtl-checklist', 'open-source-documentation-tools', 'self-host-documentation-site-docker-compose'],
    translationOf: 'arabic-technical-documentation-rtl-checklist',
    readingMinutes: 7,
    faqs: [
      {
        question: 'Why can Arabic documentation search miss a word that is on the page?',
        answer:
          'An English tokenizer can drop Arabic text entirely. Nibleaf selects Orama’s Arabic tokenizer, normalizes common spelling variants, and applies conservative light morphology to prefixes, attached pronouns, and common plural or dual forms while preserving exact tokens.',
      },
      {
        question: 'Does Docusaurus support Arabic and RTL layouts?',
        answer:
          'Yes. Docusaurus supports an RTL direction per locale and builds each locale separately. Search, fonts, and the editing workflow still need to be chosen and tested for Arabic.',
      },
      {
        question: 'Should Arabic docs mirror the English page tree one to one?',
        answer:
          'Not necessarily. An Arabic section can begin with the pages its readers need most. A per-language tree lets each version grow independently while hreflang connects the pages that correspond.',
      },
      {
        question: 'Which hreflang code should Arabic documentation use?',
        answer:
          'Use ar unless the content is genuinely specific to a region. Each alternate must include itself and its counterpart, and x-default can identify the fallback for unmatched users.',
      },
    ],
  },
  {
    slug: 'docs-should-live-in-plain-markdown',
    title: 'Your Docs Should Live in Plain Markdown (Even With a Visual Editor)',
    metaTitle: 'Why documentation should live in Markdown | Nibleaf',
    description:
      'Why plain Markdown is the portability contract for documentation: greppable, diffable, AI-ready, and compatible with a visual editor.',
    datePublished: '2026-07-13',
    dateModified: '2026-08-17',
    tags: ['markdown', 'content-ownership'],
    related: [
      'open-source-documentation-tools',
      'introducing-nibleaf-open-source-mintlify-alternative',
      'self-host-documentation-site-docker-compose',
    ],
    readingMinutes: 7,
    faqs: [
      {
        question: 'Can a WYSIWYG editor really store plain Markdown?',
        answer:
          'Yes. The editor parses Markdown into an in-memory document model for editing, then serializes back to Markdown on every save. As long as nothing editor-internal is ever persisted, the stored format stays plain Markdown.',
      },
      {
        question: 'Is Markdown expressive enough for a real documentation site?',
        answer: 'Standard Markdown covers most documentation. For richer layouts, MDX components fill the gap while keeping the content plain text.',
      },
      {
        question: 'Why does Markdown matter for AI tools and RAG pipelines?',
        answer:
          'LLM tooling consumes Markdown directly, and heading structure gives retrieval pipelines useful chunk boundaries without a proprietary extraction step.',
      },
      {
        question: 'How do I migrate docs off a platform that stores content as JSON blocks?',
        answer:
          'You depend on the vendor’s exporter or API, and fidelity varies by block type. A Markdown-based platform can provide a portable Markdown export, but database-backed products still require an export step.',
      },
    ],
  },
  {
    slug: 'introducing-nibleaf-open-source-mintlify-alternative',
    title: 'Why we built Nibleaf for teams that want to own their docs',
    metaTitle: 'Why we built Nibleaf for documentation ownership',
    description:
      'Why Nibleaf combines a visual Markdown editor, versioned publishing, built-in search, and Arabic support in one documentation platform.',
    datePublished: '2026-07-13',
    dateModified: '2026-08-17',
    tags: ['announcement', 'open-source'],
    related: ['docs-should-live-in-plain-markdown', 'self-host-documentation-site-docker-compose', 'arabic-documentation-rtl'],
    readingMinutes: 7,
    faqs: [
      {
        question: 'Is Nibleaf available as a hosted product?',
        answer:
          'Yes. Nibleaf Cloud is available in beta, and the public AGPL-3.0 release can be installed with a pinned GHCR image and Docker Compose.',
      },
      {
        question: 'Does Nibleaf lock content into a proprietary format?',
        answer:
          'Pages are stored as Markdown in the database and can be exported as Markdown. The live source is not a directory in Git unless the team exports and commits it.',
      },
      {
        question: 'Does Nibleaf support Arabic and right-to-left documentation?',
        answer:
          'Yes. Each language gets its own page tree, RTL layout is built into the reader and editor, search uses an Arabic tokenizer, and the interface is localized in English and Arabic.',
      },
    ],
  },
  {
    slug: 'open-source-documentation-tools',
    title: 'Open-source documentation tools in 2026: how to choose',
    metaTitle: '7 open-source documentation tools compared (2026)',
    description:
      'Compare Docusaurus, MkDocs Material, Starlight, Fumadocs, BookStack, Wiki.js, and Nibleaf by authoring model, search, i18n, and hosting.',
    datePublished: '2026-07-13',
    dateModified: '2026-08-17',
    tags: ['comparison', 'open-source'],
    related: [
      'self-host-documentation-site-docker-compose',
      'docs-should-live-in-plain-markdown',
      'introducing-nibleaf-open-source-mintlify-alternative',
    ],
    readingMinutes: 7,
    faqs: [
      {
        question: 'What is the best open-source documentation tool?',
        answer:
          'It depends on the writing workflow. Git-centered teams often prefer Docusaurus or Starlight. Teams that need a browser editor should compare BookStack, Wiki.js, and Nibleaf, then verify each public installation path.',
      },
      {
        question: 'Which open-source documentation tools support Arabic and RTL?',
        answer:
          'Starlight and Docusaurus support RTL locales. Nibleaf adds per-language page trees, an Arabic tokenizer, and an Arabic interface. Test search, bidirectional code, and fonts in any candidate.',
      },
      {
        question: 'Can non-developers contribute to docs-as-code tools?',
        answer:
          'Yes, through a Git web UI or CMS layer, but the review and build workflow still uses Git. Browser-editor platforms remove that requirement for routine edits.',
      },
    ],
  },
  {
    slug: 'self-host-documentation-site-docker-compose',
    title: 'Self-Host a Documentation Site with Docker Compose',
    description:
      'A practical walkthrough for self-hosting a documentation site with Docker Compose: server sizing, secrets, custom domains, backups, and upgrades.',
    datePublished: '2026-07-13',
    dateModified: '2026-08-15',
    tags: ['self-hosting', 'docker', 'guide'],
    related: ['introducing-nibleaf-open-source-mintlify-alternative', 'open-source-documentation-tools', 'docs-should-live-in-plain-markdown'],
    readingMinutes: 6,
    faqs: [
      {
        question: 'How much RAM do I need to self-host a documentation site?',
        answer:
          'The project’s starting recommendation is 2 GB when pulling a prebuilt image. Measure the complete stack under your own content and traffic before choosing production capacity.',
      },
      {
        question: 'How do I back up a self-hosted documentation site?',
        answer:
          'Back up PostgreSQL and the object-storage bucket. Queue and cache state is disposable. Test restoring both backups, not only creating them.',
      },
      {
        question: 'Do I have to run database migrations manually when upgrading?',
        answer:
          'The production Compose stack includes a one-shot migration service that applies pending migrations before the application services start.',
      },
      {
        question: 'Can I use my own domain with a self-hosted docs site?',
        answer: 'Yes. Configure DNS and TLS at the reverse proxy, then set the application and site-domain environment values consistently.',
      },
    ],
  },
] satisfies BlogEntry[];
