import { availabilityNote, groupAvailabilityNote, heroAvailabilityNote } from './availability';
import { LANDING_META } from './landing-meta';
import type { LandingCopy } from './types';

// Every factual sentence here is traced to evidence in
// .github/assets/feat-landing-marketing-refresh/fact-check/copy-notes.md. Cloud availability of Ask AI, the
// support MCP, docs insights and bring-your-own key is worded only through
// availabilityNote().
export const landingEn: LandingCopy = {
  meta: LANDING_META.en,
  hero: {
    eyebrow: 'Open-source documentation platform',
    title: 'Docs that answer your customers.',
    subtitle:
      'Write in a visual editor, publish a searchable docs site. Readers get AI answers that cite the exact section, in their language. See what they couldn’t find and fix it, even from your AI assistant.',
    primaryCta: { label: 'Start free', href: '/sign-up' },
    secondaryCta: { label: 'Self-host Nibleaf', href: '/self-hosting' },
    tertiaryLink: { label: 'See our own docs, published with Nibleaf', href: 'https://docs.nibleaf.com' },
    assurances: ['Free cloud beta, no credit card', 'Open source under AGPL-3.0', 'English and Arabic, right to left'],
    availabilityNote: heroAvailabilityNote('en'),
    media: {
      key: 'hero-chat',
      alt: 'A published docs page for a fictional notes app, with Ask AI open on a phone. The answer explains why sync stopped and cites two numbered sections of “Fix sync problems”.',
      caption: 'Real product screenshot. Demo content: a fictional notes app.',
    },
  },
  proof: {
    label: 'What you can check for yourself',
    items: [
      {
        icon: 'openSource',
        title: 'Open source',
        body: 'The whole product is AGPL-3.0: editor, server and workers. Read every line on GitHub.',
        href: 'https://github.com/lord007tn/nibleaf',
      },
      {
        icon: 'server',
        title: 'Runs on your servers',
        body: 'A guided Docker Compose installer sets up the full stack on your own server.',
        href: '/self-hosting',
      },
      {
        icon: 'support',
        title: 'We use it ourselves',
        body: 'Nibleaf’s own documentation is written and published with Nibleaf.',
        href: 'https://docs.nibleaf.com',
      },
      {
        icon: 'exports',
        title: 'Take your content with you',
        body: 'Pages are stored as Markdown. Export to Markdown, HTML or PDF whenever you like.',
      },
    ],
  },
  features: [
    {
      id: 'ask-ai',
      eyebrow: 'Ask AI',
      title: 'Answers from your docs, with sources.',
      body: 'Readers ask in their own words and get an answer built only from your published docs, with links to the exact sections it used.',
      bullets: [
        'Replies in the reader’s language, including Arabic and questions that mix Arabic and English',
        'Says when it can’t answer, and suggests articles or your support link instead of guessing',
        'Offers related questions, and readers can rate every answer',
      ],
      noteLabel: 'Requirements and availability',
      note: `Needs an AI provider key: your workspace’s own OpenAI or OpenRouter key, or one your instance provides. You turn it on per site, and self-hosters also run the optional Qdrant search service. ${availabilityNote('askAi', 'en')}`,
      media: {
        key: 'chat',
        alt: 'The Ask AI panel answering a question about exporting notes. Numbered sources name the exact sections of “Export your notes”, with thumbs up and down buttons and two related questions below.',
        caption: 'Real product screenshot. Demo content: a fictional notes app.',
      },
    },
    {
      id: 'search',
      eyebrow: 'Search',
      title: 'Search that lands on the right section.',
      body: 'Built-in search lists each matching section under its page and takes readers straight to that heading. It needs no AI key and no extra service.',
      bullets: [
        'Opens with ⌘K or Ctrl+K, and remembers recent searches on the reader’s device',
        'Finds Arabic words with or without diacritics and across spelling variants',
        'Turns a search into an Ask AI question in one step when Ask AI is on',
      ],
      noteLabel: 'Availability',
      note: availabilityNote('readerSearch', 'en'),
      media: {
        key: 'search',
        alt: 'The docs search dialog for the query “download”, listing each matching page with its matching sections underneath.',
        caption: 'Real product screenshot. Demo content: a fictional notes app.',
      },
    },
    {
      id: 'insights',
      eyebrow: 'Insights',
      title: 'See what readers can’t find.',
      body: 'Plain-language reports show which searches failed, which pages readers rated unhelpful, and which AI tools are reading your docs.',
      bullets: [
        'Failed searches, each with a “Write an article for this” button that opens a new draft',
        'Helpful and not-helpful votes by page, so you know what to fix first',
        'AI crawler visits, kept apart from people who arrive from AI assistants',
      ],
      noteLabel: 'Requirements and availability',
      note: `Self-hosters need the optional ClickHouse analytics service for these reports. Search terms are kept only if you turn that on. ${availabilityNote('docsInsights', 'en')}`,
      media: {
        key: 'insights',
        alt: 'The “Searches that failed” table in Nibleaf analytics. Each term, including one in Arabic, has a “Write an article for this” button.',
        caption: 'Real product screenshot from a local test site.',
      },
    },
    {
      id: 'mcp',
      eyebrow: 'AI assistants (MCP)',
      title: 'Fix the gaps from Claude, ChatGPT or Cursor.',
      body: 'Connect your AI assistant to a docs project. It can look up failed searches, draft and translate articles, and publish only after you confirm a fresh preview.',
      bullets: [
        'Connect by signing in, or with a scoped key that expires',
        'Three permission presets: Read only, Support writer and Full admin',
        'Changes save as drafts; there is no tool to delete pages or change general settings',
      ],
      noteLabel: 'Requirements and availability',
      note: `Self-hosters turn it on first; it is off by default. ${availabilityNote('supportMcp', 'en')}`,
      media: {
        key: 'mcp',
        alt: 'A recorded Claude Code session connected to a Nibleaf project with a Support writer key. It finds searches with no results, drafts the missing article, previews and publishes it after the person confirms, then translates it to Arabic.',
        caption:
          'Replay of a real Claude Code session against a demo project, rendered from its transcript. The demo’s product facts, such as the Okta sign-on steps, are made up. Arabic text shows as [Arabic] in this terminal view. Press play to watch.',
      },
    },
    {
      id: 'editor',
      eyebrow: 'Editor',
      title: 'An editor your whole team can use.',
      body: 'Type / to add callouts, steps, tabs, tables, code and images. Nobody has to learn Markdown, yet every page is stored as Markdown.',
      bullets: [
        'Leave review comments right on the text',
        'Preview privately, then publish when you’re ready',
        'Every publish is a snapshot you can roll back to',
      ],
      media: {
        key: 'editor',
        alt: 'The Nibleaf editor with the slash menu open over an article, listing basic blocks such as text, headings and lists.',
      },
    },
    {
      id: 'arabic',
      eyebrow: 'Arabic and RTL',
      title: 'Arabic that reads right, on every screen.',
      body: 'Write in Arabic and English with right-to-left layout in the editor, dashboard and docs site, a separate page tree for each language, and search tuned for Arabic.',
      bullets: [
        'All three reader themes mirror for right to left, in light and dark',
        'Ask AI answers Arabic questions in Arabic, citing your Arabic pages',
        'Linked translations tell search engines which language each page is in',
      ],
      noteLabel: 'Availability',
      note: groupAvailabilityNote('Reader themes and Ask AI', ['readerThemes', 'askAi'], 'en'),
      media: {
        key: 'arabic',
        alt: 'An Arabic docs site in right-to-left layout on a phone.',
        caption: 'Real product screenshot. Demo content: a fictional notes app.',
      },
    },
  ],
  more: {
    eyebrow: 'Also included',
    title: 'The rest of what a docs team needs',
    body: 'Part of the same open-source product, not add-ons.',
    items: [
      {
        icon: 'themes',
        title: 'Three reader themes',
        body: 'Harbor, Manuscript and Signal: three layouts, each in light and dark, left to right or right to left.',
        availability: 'readerThemes',
      },
      { icon: 'domains', title: 'Custom domains', body: 'Put your docs on your own domain, with guided DNS checks.' },
      { icon: 'versions', title: 'Versions and rollback', body: 'Keep docs for each product version, and roll back to any earlier publish.' },
      {
        icon: 'git',
        title: 'GitHub two-way sync',
        body: 'Writers edit in the browser, engineers in GitHub, and changes flow both ways through pull requests.',
      },
      { icon: 'exports', title: 'Exports', body: 'Markdown, HTML or PDF, on demand or on a daily, weekly or monthly schedule.' },
      { icon: 'api', title: 'API reference', body: 'Import an OpenAPI file and get endpoint pages readers can try in the browser.' },
      { icon: 'private', title: 'Private docs', body: 'Share docs, or single pages, only with readers you invite.' },
      { icon: 'llms', title: 'Ready for AI tools', body: 'Indexable public pages are listed in llms.txt, with their full text in llms-full.txt.' },
      {
        icon: 'key',
        title: 'Your own AI key',
        body: 'Connect your workspace’s OpenAI or OpenRouter key. It is stored encrypted.',
        availability: 'bringYourOwnKey',
      },
    ],
  },
  howItWorks: {
    eyebrow: 'How it works',
    title: 'Write, publish, answer, improve',
    body: 'A simple loop for support and product teams.',
    steps: [
      { title: 'Write or import', body: 'Write in the visual editor, or import a public Mintlify repository from GitHub.' },
      { title: 'Publish', body: 'Preview your changes, publish, and put the site on your own domain.' },
      { title: 'Answer', body: 'Readers search, or ask AI and get answers that cite your pages, in their language.' },
      { title: 'Improve', body: 'See what readers couldn’t find, then fix it in the editor or from your AI assistant.' },
    ],
    note: groupAvailabilityNote('Ask AI, insights and AI-assistant connections', ['askAi', 'docsInsights', 'supportMcp'], 'en'),
  },
  paths: {
    eyebrow: 'Two ways to run it',
    title: 'Free cloud beta, or your own servers',
    body: 'One open-source codebase. New features reach the self-hosted release when a version that includes them ships.',
    cloud: {
      name: 'Nibleaf Cloud',
      price: 'Free during the beta',
      priceNote: 'No credit card at sign-up',
      points: ['Nothing to install or maintain', 'Visual editor, docs site, search and team roles', 'Newer AI features arrive as they roll out'],
      cta: { label: 'Create a free account', href: '/sign-up' },
      footnote: 'No paid cloud plan is offered today.',
    },
    selfHost: {
      name: 'Self-hosted',
      price: 'Free',
      priceNote: 'Open source under AGPL-3.0',
      points: [
        'Guided Docker Compose installer',
        'PostgreSQL and a Redis-compatible cache, plus S3-compatible storage: the bundled one or your own',
        'Optional services: Qdrant for Ask AI, ClickHouse for insights',
      ],
      cta: { label: 'Read the self-hosting guide', href: '/self-hosting' },
      footnote: 'You run the servers, updates and backups, and pay your own AI provider for AI features.',
    },
    detailsLink: { label: 'Compare both options in detail', href: '/pricing' },
  },
  compare: {
    eyebrow: 'Comparisons',
    title: 'Coming from another docs tool?',
    body: 'Side-by-side comparisons that link to each vendor’s official pages and say plainly what Nibleaf doesn’t do yet.',
    links: [
      {
        label: 'Nibleaf vs Mintlify',
        href: '/compare/nibleaf-vs-mintlify',
        description: 'A self-hostable open-source stack versus Mintlify’s hosted platform.',
      },
      {
        label: 'Nibleaf vs GitBook',
        href: '/compare/nibleaf-vs-gitbook',
        description: 'The whole product open source versus GitBook’s hosted workspace.',
      },
      {
        label: 'Nibleaf vs Docusaurus',
        href: '/compare/nibleaf-vs-docusaurus',
        description: 'A visual editor and dashboard versus a static-site framework.',
      },
    ],
  },
  faq: {
    eyebrow: 'FAQ',
    title: 'Questions, answered',
    items: [
      {
        q: 'Is Nibleaf free?',
        a: 'Nibleaf Cloud is free during the beta, and sign-up needs no credit card. No paid cloud plan is offered today. Self-hosting is free under AGPL-3.0; you pay for your own servers and any AI provider you use.',
      },
      {
        q: 'What’s the difference between Cloud and self-hosting?',
        a: 'It’s one open-source codebase. On Nibleaf Cloud, we run it for you. Self-hosted, you install it on your own servers with Docker Compose, choose your storage and optional services, and look after updates and backups. New features reach self-hosters with the next release that includes them.',
      },
      {
        q: 'What do I need for Ask AI, and who pays for the AI?',
        a: `Ask AI needs an AI provider key and is turned on per site. With your workspace’s own OpenAI or OpenRouter key, stored encrypted, your provider bills you for those calls. An instance can also provide a key of its own. Daily limits on answers and tokens keep usage in check, and self-hosters also run the optional Qdrant search service. The editor’s writing assistant is separate and doesn’t use your workspace key. ${availabilityNote('askAi', 'en')}`,
      },
      {
        q: 'Does Ask AI make things up?',
        a: 'It answers only from your published docs and cites the sections it used. When it isn’t confident, it says so and suggests articles or your support link instead. AI models can still make mistakes, which is why readers always see the sources.',
      },
      {
        q: 'Can I leave and take my content?',
        a: 'Yes. Pages are stored as Markdown, and you can export them at any time as Markdown, HTML or PDF, or keep them in your own GitHub repository. The code is open source too.',
      },
      {
        q: 'Can I import from Mintlify or GitBook?',
        a: `Yes, from a public GitHub repository: a Mintlify docs repo, or a GitBook repo set up with Git Sync. Pages, navigation and images come across. Check any custom components after the import. Ghost exports can be imported too. ${groupAvailabilityNote('GitBook import', ['gitbookImport'], 'en') ?? ''}`,
      },
      {
        q: 'How good is the Arabic support?',
        a: `Arabic is first-class: right-to-left editor, dashboard and docs site, a separate page tree per language, search that handles Arabic spelling and diacritics, and Ask AI replies in Arabic. The dashboard offers 12 interface languages, though some strings are still in English. Your content can be in any language. ${groupAvailabilityNote('Ask AI', ['askAi'], 'en') ?? ''}`,
      },
      {
        q: 'Which AI assistants can connect?',
        a: `Assistants that support MCP. Our docs cover ChatGPT, Claude (web, desktop and Claude Code), Cursor and VS Code. Connect by signing in, or with a scoped key that expires. Self-hosters turn MCP on first. ${availabilityNote('supportMcp', 'en')}`,
      },
      {
        q: 'What happens to my readers’ data?',
        a: `Reader analytics store no IP addresses. If your site asks readers for consent, their visits are linked only after they agree. Search terms are kept only if you turn that on, and a term appears only after two different visits searched for it. Ask AI sends questions and matching passages to the AI provider you choose, under that provider’s terms. You can turn off saving Ask AI conversations. ${groupAvailabilityNote('The analytics pipeline described here', ['readerAnalytics'], 'en') ?? ''}`,
      },
    ],
  },
  blog: {
    eyebrow: 'From the blog',
    title: 'Notes on documentation',
    allLink: { label: 'All articles', href: '/blog' },
    readingTime: (minutes) => `${minutes} min read`,
  },
  finalCta: {
    title: 'Give your customers docs that answer.',
    body: 'Start free on Nibleaf Cloud, or run it on your own servers.',
    primary: { label: 'Start free', href: '/sign-up' },
    secondary: { label: 'Self-host Nibleaf', href: '/self-hosting' },
  },
};
