import { availabilityNote, groupAvailabilityNote, heroAvailabilityNote } from './availability';
import type { MediaRef, UseCaseCopy, UseCaseSlug, UseCasesTeaserCopy } from './types';

// Evidence for every claim is in
// .github/assets/feat-landing-marketing-refresh/fact-check/copy-notes.md.
// Cloud availability is worded only through availabilityNote().

const askAiNote = `Needs an AI provider key: your workspace’s own OpenAI or OpenRouter key, or one your instance provides. You turn it on per site, and self-hosters also run the optional Qdrant search service. ${availabilityNote('askAi', 'en')}`;
const insightsNote = `Self-hosters need the optional ClickHouse analytics service for these reports. Search terms are kept only if you turn that on. ${availabilityNote('docsInsights', 'en')}`;
const mcpNote = `Self-hosters turn it on first; it is off by default. ${availabilityNote('supportMcp', 'en')}`;
const demoCaption = 'Real product screenshot. Demo content: a fictional notes app.';

// Same images as the landing page, so the same descriptions.
const media = {
  heroChat: {
    key: 'hero-chat',
    alt: 'A docs site for a fictional notes app with the Ask AI panel open. The answer about exporting notes lists three numbered sources, each naming the exact section of “Export your notes” it came from, followed by related questions.',
    caption: demoCaption,
  },
  chat: {
    key: 'chat',
    alt: 'The Ask AI panel answering a question about exporting notes. Numbered sources name the exact sections of “Export your notes”, with thumbs up and down buttons and two related questions below.',
    caption: demoCaption,
  },
  insights: {
    key: 'insights',
    alt: 'The “Searches that failed” table in Nibleaf analytics. Each term, including one in Arabic, has a “Write an article for this” button. An AI visibility report sits alongside it.',
  },
  mcp: {
    key: 'mcp',
    alt: 'The “AI assistants (MCP)” project settings, with a sign-in connection and the Read only, Support writer and Full admin permission presets.',
    caption: 'Real product screenshot.',
  },
  editor: { key: 'editor', alt: 'The Nibleaf editor with the slash menu open, listing blocks such as callouts, steps, tabs and code.' },
  arabic: { key: 'arabic', alt: 'An Arabic docs site in right-to-left layout on a phone.', caption: demoCaption },
  themes: { key: 'themes', alt: 'The three Nibleaf reader themes, Harbor, Manuscript and Signal, showing the same docs.' },
  dashboard: { key: 'dashboard', alt: 'The Nibleaf dashboard for a docs project.' },
} satisfies Record<string, MediaRef>;

const startFree = { label: 'Start free', href: '/sign-up' };
const selfHost = { label: 'Self-host Nibleaf', href: '/self-hosting' };

export const useCasesEn: Record<UseCaseSlug, UseCaseCopy> = {
  'support-teams': {
    slug: 'support-teams',
    meta: {
      title: 'Help center software with cited AI answers | Nibleaf',
      description:
        'Give customers AI answers that cite your help center, see which searches fail, and fix gaps from your AI assistant. Open source, in English and Arabic.',
    },
    navLabel: 'Support teams',
    cardSummary: 'Answer repeat questions with cited AI answers, and see what customers can’t find.',
    hero: {
      eyebrow: 'For support teams',
      title: 'Let your help center answer first.',
      subtitle:
        'Customers ask in their own words and get answers from your docs, with the sections cited. You see which searches failed and fill the gaps, in English, Arabic or both.',
      availabilityNote: heroAvailabilityNote('en'),
      primaryCta: startFree,
      secondaryCta: selfHost,
      media: media.heroChat,
    },
    problems: {
      title: 'Sound familiar?',
      items: [
        {
          title: 'The same questions, every day',
          body: 'The answer is already in your docs, but customers can’t find it, so they open a ticket instead.',
        },
        {
          title: 'You can’t see what people can’t find',
          body: 'Failed searches and confusing pages stay invisible until they show up in your queue.',
        },
        {
          title: 'Two languages, twice the work',
          body: 'Keeping English and Arabic articles in step falls behind every time the product changes.',
        },
      ],
    },
    solutions: [
      {
        id: 'cited-answers',
        eyebrow: 'Ask AI',
        title: 'Answers your customers can check.',
        body: 'Ask AI answers only from your published docs and links each answer to the exact sections it used, so customers and agents can verify it.',
        bullets: [
          'Replies in the customer’s language, Arabic included',
          'When it isn’t confident, it says so and shows suggested articles and your support link',
          'Customers rate answers, and you see which questions went unanswered',
        ],
        note: askAiNote,
        media: media.chat,
      },
      {
        id: 'find-gaps',
        eyebrow: 'Insights',
        title: 'See the gaps before they become tickets.',
        body: 'Reports show the searches that found nothing and the pages readers marked unhelpful, so you know what to write next.',
        bullets: [
          'Each failed search has a “Write an article for this” button that opens a draft',
          'Helpful and not-helpful votes for every page',
          'Ask AI conversations, ratings and unanswered questions in one place',
        ],
        note: insightsNote,
        media: media.insights,
      },
      {
        id: 'fix-from-assistant',
        eyebrow: 'AI assistants (MCP)',
        title: 'Fix gaps from the assistant you already use.',
        body: 'Connect Claude, ChatGPT or Cursor to your docs project. It can pull this week’s failed searches, draft an article, translate it, and publish once you confirm the preview.',
        bullets: [
          'The Support writer preset can draft and publish, but not change settings',
          'Ready-made prompts include finding content gaps and a weekly docs health report',
          'Changes save as drafts; publishing needs a fresh preview and your confirmation',
        ],
        note: mcpNote,
        media: media.mcp,
      },
      {
        id: 'bilingual-help-center',
        eyebrow: 'English and Arabic',
        title: 'One help center, in both languages.',
        body: 'Each language gets its own page tree, right-to-left layout and Arabic-aware search, so Arabic customers get the same help as everyone else.',
        bullets: [
          'Search finds Arabic words with or without diacritics',
          'Ask AI handles questions that mix Arabic and English',
          'Your AI assistant can draft a translation for you to review',
        ],
        media: media.arabic,
      },
    ],
    workflow: {
      title: 'A weekly routine for your support team',
      steps: [
        { title: 'Bring your articles in', body: 'Write in the visual editor, or import a public Mintlify repository from GitHub.' },
        { title: 'Turn on Ask AI', body: 'Connect an AI provider key, switch Ask AI on for the site, and add your support link.' },
        { title: 'Review what failed', body: 'Check failed searches, unhelpful pages and unanswered questions once a week.' },
        { title: 'Draft the fixes', body: 'Write in the editor, or let your AI assistant draft and translate the missing articles.' },
        { title: 'Preview and publish', body: 'Confirm the preview and publish. You can roll back to an earlier publish at any time.' },
      ],
    },
    faq: {
      title: 'Questions from support teams',
      items: [
        {
          q: 'Does Nibleaf replace our ticketing tool?',
          a: 'No. Nibleaf is your help center and docs site. It has no ticket inbox, live human chat or CRM. When Ask AI can’t answer, it can point customers to the support link you set.',
        },
        {
          q: 'What do customers see when the AI isn’t sure?',
          a: 'A plain message that it couldn’t find a reliable answer, with suggested articles and your support link if you’ve added one. Every answer also shows its sources, and the panel reminds readers that AI can make mistakes.',
        },
        {
          q: 'Can we see what customers asked?',
          a: `Yes. The Ask AI reports list conversations, ratings and questions your docs couldn’t answer, plus usage and the cost your provider reports. Self-hosters need ClickHouse for these reports, and you can turn off saving conversations. ${availabilityNote('docsInsights', 'en')}`,
        },
        {
          q: 'Who pays for the AI?',
          a: `With your workspace’s own OpenAI or OpenRouter key, your provider bills you directly. Daily limits on answers and tokens keep usage in check. An instance can also provide a key of its own. ${availabilityNote('askAi', 'en')}`,
        },
        {
          q: 'Can it answer in Arabic?',
          a: 'Yes. Ask AI replies in the language of the question, Arabic included, and the docs site, search and editor all work right to left.',
        },
      ],
    },
    related: {
      title: 'Keep reading',
      links: [
        {
          label: 'Building a customer support knowledge base',
          href: '/blog/customer-support-knowledge-base',
          description: 'How to structure help content customers can find.',
        },
        { label: 'Nibleaf vs GitBook', href: '/compare/nibleaf-vs-gitbook', description: 'Plans, AI features and hosting, with sources.' },
        { label: 'Pricing', href: '/pricing', description: 'Free cloud beta or self-hosting, compared.' },
        {
          label: 'Nibleaf for product teams',
          href: '/use-cases/product-docs',
          description: 'Visual editing, versions and translations for product docs.',
        },
      ],
    },
    finalCta: {
      title: 'Let your docs take the first question.',
      body: 'Start free on Nibleaf Cloud, or run it on your own servers.',
      primary: startFree,
      secondary: selfHost,
    },
  },

  'product-docs': {
    slug: 'product-docs',
    meta: {
      title: 'Product documentation for PMs and writers | Nibleaf',
      description:
        'A visual editor for product managers and writers, GitHub sync for engineers, previews, versions and translations. Open-source docs, free cloud beta.',
    },
    navLabel: 'Product teams',
    cardSummary: 'A visual editor for product managers and writers, with previews, versions and translations.',
    hero: {
      eyebrow: 'For product managers and writers',
      title: 'Product docs your whole team can update.',
      subtitle:
        'Product managers and writers work in a visual editor; engineers can stay in GitHub. Preview every change, publish versioned docs in your own theme, and keep translations in step.',
      primaryCta: startFree,
      secondaryCta: selfHost,
      media: media.editor,
    },
    problems: {
      title: 'Sound familiar?',
      items: [
        { title: 'Every edit waits for an engineer', body: 'The docs live in a code repository, so a one-line fix needs someone who knows Git.' },
        { title: 'Releases move faster than the docs', body: 'Customers on older versions read pages written for the newest one.' },
        { title: 'Translations drift', body: 'The English page changes and the other languages quietly fall out of date.' },
      ],
    },
    solutions: [
      {
        id: 'visual-editor',
        eyebrow: 'Editor',
        title: 'Write without learning Markdown.',
        body: 'Type / to add callouts, steps, tabs, cards, tables, code and images. Pages are still stored as Markdown, so nothing is locked in.',
        bullets: [
          'Leave review comments right on the text',
          'Find any page, setting or action with ⌘K or Ctrl+K',
          'A start-here checklist walks new projects from first page to first publish',
        ],
        media: media.editor,
      },
      {
        id: 'publish-safely',
        eyebrow: 'Previews and versions',
        title: 'Publish with confidence.',
        body: 'Preview changes privately, publish when ready, and keep separate docs for each product version. Every publish is a snapshot you can roll back to.',
        bullets: [
          'Engineers can work in GitHub, with changes flowing both ways through pull requests',
          'Each GitHub pull request gets its own preview link',
          'Keep internal docs private and share them only with invited readers',
        ],
        media: media.dashboard,
      },
      {
        id: 'themes',
        eyebrow: 'Themes',
        title: 'Docs that look like your product.',
        body: 'Pick one of three reader layouts, Harbor, Manuscript or Signal, and add your logo, colors and custom domain.',
        bullets: ['Each theme comes in light and dark', 'Every theme works right to left', 'Switch themes without rewriting your content'],
        noteLabel: 'Availability',
        note: availabilityNote('readerThemes', 'en'),
        media: media.themes,
      },
      {
        id: 'translations',
        eyebrow: 'Languages',
        title: 'Keep every language in step.',
        body: 'Each language has its own page tree, and translated pages are linked so readers and search engines find the right one.',
        bullets: [
          'English and Arabic are first-class, right to left included',
          'Add content in any other language',
          'Your AI assistant can draft translations as drafts for review',
        ],
        note: mcpNote,
        media: media.arabic,
      },
    ],
    workflow: {
      title: 'From draft to published release',
      steps: [
        { title: 'Write or import', body: 'Start in the visual editor, or import a public Mintlify repository from GitHub.' },
        { title: 'Review', body: 'Teammates comment on the text, or engineers review the change as a GitHub pull request.' },
        { title: 'Preview', body: 'Check the change privately before readers see it.' },
        { title: 'Publish', body: 'Publish for the right product version and language. Roll back to an earlier publish if you need to.' },
      ],
    },
    faq: {
      title: 'Questions from product teams',
      items: [
        {
          q: 'Do product managers need to know Markdown or Git?',
          a: 'No. They write in the visual editor and publish from the browser. Pages are stored as Markdown behind the scenes, and engineers can use GitHub if they prefer.',
        },
        {
          q: 'Which Git providers are supported?',
          a: 'GitHub syncs both ways, with a dedicated branch, pull requests and previews. Public GitLab and other Git repositories can be imported one way.',
        },
        {
          q: 'Can several people edit the same page at once?',
          a: 'Nibleaf doesn’t offer live co-editing with shared cursors today. Teams use review comments, previews and GitHub pull requests to work together.',
        },
        {
          q: 'How do translations work?',
          a: 'Each language has its own page tree, and you link a page to its translations. Nibleaf doesn’t machine-translate pages itself; your AI assistant can draft a translation through MCP for you to review.',
        },
        {
          q: 'Can we keep some docs private?',
          a: 'Yes. Invite readers to private docs, or to single pages, separately from your dashboard team. This is not SAML or SCIM single sign-on.',
        },
      ],
    },
    related: {
      title: 'Keep reading',
      links: [
        {
          label: 'Choosing a documentation template',
          href: '/blog/choosing-documentation-template',
          description: 'Harbor, Manuscript or Signal: which fits your docs.',
        },
        {
          label: 'Versioned documentation, release by release',
          href: '/blog/versioned-documentation-release-lifecycle',
          description: 'How to keep docs right for every product version.',
        },
        { label: 'Nibleaf vs Mintlify', href: '/compare/nibleaf-vs-mintlify', description: 'Editors, Git workflows and hosting, with sources.' },
        { label: 'Nibleaf for developers', href: '/use-cases/api-docs', description: 'OpenAPI reference, Markdown and Git, and AI-ready docs.' },
      ],
    },
    finalCta: {
      title: 'Give your whole team a docs editor.',
      body: 'Start free on Nibleaf Cloud, or run it on your own servers.',
      primary: startFree,
      secondary: selfHost,
    },
  },

  'api-docs': {
    slug: 'api-docs',
    meta: {
      title: 'API documentation with OpenAPI try-it | Nibleaf',
      description:
        'OpenAPI reference pages readers can try, Markdown guides synced with GitHub, llms.txt for AI tools, and versioned docs. Open source and self-hostable.',
    },
    navLabel: 'Developers',
    cardSummary: 'OpenAPI reference with try-it, Markdown and GitHub, and docs AI tools can read.',
    hero: {
      eyebrow: 'For developers',
      title: 'API docs that fit your Git workflow.',
      subtitle:
        'Import an OpenAPI file for endpoint pages readers can try, write guides in Markdown synced with GitHub, and give AI tools clean text. Use the free cloud beta or your own servers.',
      primaryCta: startFree,
      secondaryCta: selfHost,
      media: media.themes,
    },
    problems: {
      title: 'Sound familiar?',
      items: [
        { title: 'Reference and guides drift apart', body: 'The API changes, the guides don’t, and readers find out the hard way.' },
        { title: 'Docs sit outside code review', body: 'Writers edit in one tool, engineers in another, and nobody reviews the same change.' },
        { title: 'AI coding tools read your docs badly', body: 'Assistants scrape your HTML pages instead of getting clean text they can use.' },
      ],
    },
    solutions: [
      {
        id: 'openapi-reference',
        eyebrow: 'API reference',
        title: 'Reference pages from your OpenAPI file.',
        body: 'Import an OpenAPI 3.x file and Nibleaf builds endpoint and schema pages, with a try-it panel readers use in the browser.',
        bullets: [
          'External references in your spec are bundled on import',
          'Write guides alongside the reference with code groups and request and response examples',
          'The Signal theme is laid out for code-heavy docs',
        ],
        noteLabel: 'Availability',
        note: groupAvailabilityNote('Reader themes, including Signal', ['readerThemes'], 'en'),
      },
      {
        id: 'markdown-git',
        eyebrow: 'Markdown and Git',
        title: 'Keep docs in your review process.',
        body: 'Connect a GitHub repository: browser edits land on a dedicated branch and pull request, and changes made in the repo flow back into Nibleaf.',
        bullets: [
          'Pages are stored as Markdown you can read and diff',
          'Each pull request gets its own preview link, hidden from search engines',
          'When a page changes in both places, you resolve the conflict in Nibleaf',
        ],
        media: media.editor,
      },
      {
        id: 'ai-ready',
        eyebrow: 'AI tools',
        title: 'Docs AI tools can actually read.',
        body: 'Every site serves llms.txt, llms-full.txt and a Markdown version of each page. Private pages stay out of them.',
        bullets: [
          'Connect Claude Code, Cursor or VS Code to your docs project over MCP',
          'Read only, Support writer and Full admin presets keep access scoped',
          'Publishing from an assistant always needs a fresh preview and confirmation',
        ],
        note: mcpNote,
        media: media.mcp,
      },
      {
        id: 'self-host-versions',
        eyebrow: 'Self-hosting and versions',
        title: 'Run it where your code runs.',
        body: 'The whole product is open source under AGPL-3.0, with a Docker Compose installer for your own servers, and separate docs for each API version.',
        bullets: [
          'Needs PostgreSQL, a Redis-compatible cache and S3-compatible storage; storage comes bundled',
          'Qdrant for Ask AI and ClickHouse for insights are optional',
          'Ask AI answers from the version and language the reader is viewing',
        ],
        media: media.dashboard,
      },
    ],
    workflow: {
      title: 'How developer teams set it up',
      steps: [
        { title: 'Import your spec', body: 'Upload an OpenAPI file, point to its URL, or pick it from your connected repository.' },
        { title: 'Connect GitHub', body: 'Link the repository so guides and reference changes go through pull requests.' },
        { title: 'Write the guides', body: 'Use the editor or your code editor, with code groups and request and response examples.' },
        { title: 'Publish and version', body: 'Preview, publish, and keep a separate version of the docs for each API release.' },
      ],
    },
    faq: {
      title: 'Questions from developers',
      items: [
        {
          q: 'Which OpenAPI versions are supported?',
          a: 'OpenAPI 3.x. Nibleaf validates the file and bundles external references when you import it.',
        },
        {
          q: 'Does try-it work with any API?',
          a: 'Requests go from the reader’s browser to your API, so your API has to allow them (CORS) and readers supply their own credentials. Nibleaf doesn’t mock or monitor your API.',
        },
        {
          q: 'Can I write docs in my own code editor?',
          a: 'Yes. With GitHub two-way sync you edit Markdown in the repository and open pull requests as usual. Public GitLab and other Git repositories can be imported one way.',
        },
        {
          q: 'What do AI tools get from my docs?',
          a: 'Each site serves llms.txt, llms-full.txt and a Markdown version of every page, limited to content readers are allowed to see. Your team can also connect AI assistants to the project over MCP.',
        },
        {
          q: 'What does self-hosting need?',
          a: 'Docker Compose with PostgreSQL, a Redis-compatible cache and S3-compatible storage (bundled by default). Qdrant and ClickHouse are optional. The published image targets linux/amd64.',
        },
      ],
    },
    related: {
      title: 'Keep reading',
      links: [
        { label: 'Developers', href: '/developers', description: 'Public API, Markdown endpoints and reader access.' },
        { label: 'Self-hosting guide', href: '/self-hosting', description: 'Install the full stack on your own servers.' },
        {
          label: 'OpenAPI try-it: security and versioning',
          href: '/blog/openapi-try-it-security-versioning',
          description: 'What to check before you ship an interactive reference.',
        },
        { label: 'AI-ready documentation', href: '/blog/ai-ready-documentation', description: 'llms.txt, page Markdown and what AI tools can read.' },
        {
          label: 'Nibleaf vs Docusaurus',
          href: '/compare/nibleaf-vs-docusaurus',
          description: 'A visual editor and dashboard versus a static-site framework.',
        },
      ],
    },
    finalCta: {
      title: 'Ship API docs from your own workflow.',
      body: 'Start free on Nibleaf Cloud, or run it on your own servers.',
      primary: startFree,
      secondary: selfHost,
    },
  },
};

export const useCasesTeaserEn: UseCasesTeaserCopy = {
  eyebrow: 'Use cases',
  title: 'Built for the teams who own your docs',
  body: 'See how Nibleaf fits support teams, product teams and developers.',
};
