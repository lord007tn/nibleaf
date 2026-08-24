import { ENTITY_SENTENCE } from '@/lib/marketing-seo';

/**
 * Data for the /compare and /alternatives SEO pages.
 *
 * Rules of evidence for this file: every competitor price or plan detail was
 * read from the vendor's official pricing page and carries `asOf` + a
 * `sourceUrl`. Where an official page renders a price dynamically (so we could
 * not verify the number), we link to the page instead of quoting a figure.
 * Nibleaf's own gaps are stated plainly and point at the public roadmap.
 */

/** Date the competitor pricing pages were last checked. */
export const AS_OF = 'August 17, 2026';

export type FeatureValue = 'yes' | 'no' | 'partial' | 'planned' | 'unknown';

export interface FeatureCell {
  value: FeatureValue;
  note?: string;
}

export interface FeatureRow {
  feature: string;
  nibleaf: FeatureCell;
  competitor: FeatureCell;
}

export interface PricingRow {
  plan: string;
  price: string;
  includes: string;
}

export interface PricingTable {
  productName: string;
  sourceUrl: string;
  sourceLabel: string;
  asOf: string;
  rows: PricingRow[];
  note?: string;
}

export interface FaqEntry {
  q: string;
  a: string;
}

export interface PickReasons {
  title: string;
  reasons: string[];
}

export interface Comparison {
  slug: string;
  path: string;
  competitorName: string;
  competitorUrl: string;
  metaTitle: string;
  metaDescription: string;
  heading: string;
  breadcrumbName: string;
  /** 2–3 plain sentences answering the query directly, then the entity sentence. */
  directAnswer: string[];
  competitorPricing: PricingTable;
  features: FeatureRow[];
  pickCompetitor: PickReasons;
  pickNibleaf: PickReasons;
  verdict: string[];
  faqs: FaqEntry[];
}

export interface AlternativeEntry {
  name: string;
  url: string;
  description: string;
  bestFor: string;
  isNibleaf?: boolean;
}

export interface AlternativesRoundup {
  slug: string;
  path: string;
  competitorName: string;
  competitorUrl: string;
  metaTitle: string;
  metaDescription: string;
  heading: string;
  breadcrumbName: string;
  directAnswer: string[];
  competitorPricing: PricingTable;
  alternatives: AlternativeEntry[];
  faqs: FaqEntry[];
}

const yes = (note?: string): FeatureCell => ({ value: 'yes', note });
const no = (note?: string): FeatureCell => ({ value: 'no', note });
const partial = (note: string): FeatureCell => ({ value: 'partial', note });
const planned = (note?: string): FeatureCell => ({ value: 'planned', note });

/** Nibleaf's own two "plans", shown next to every competitor table. */
export const nibleafPricing: PricingTable = {
  productName: 'Nibleaf',
  sourceUrl: '/pricing',
  sourceLabel: 'nibleaf.com/pricing',
  asOf: AS_OF,
  rows: [
    {
      plan: 'Cloud',
      price: 'Free while in beta',
      includes: 'Hosted dashboard and docs sites, managed database and storage, custom domains, analytics, search. Fair-use limits, no credit card.',
    },
    {
      plan: 'Self-hosted',
      price: 'Free under AGPL-3.0',
      includes: 'Public source, pinned GHCR release, guided Docker Compose installer, PostgreSQL, cache, workers, and S3-compatible storage.',
    },
  ],
  note: 'No paid cloud plan is currently offered. Self-hosting requires your own DNS, TLS, backups, monitoring, and upgrades.',
};

/** Product gaps that must stay consistent across comparison and machine-readable marketing surfaces. */
export const nibleafProductLimitations = [
  'Live multi-user co-editing is not currently available.',
  'SAML/SCIM is not currently available.',
  'Adaptive content is not currently available.',
  'Grounded answers require optional operator-configured providers and explicit project opt-in; they are not part of the v0.1.2 self-hosted artifact.',
] as const;

const mintlifyPricing: PricingTable = {
  productName: 'Mintlify',
  sourceUrl: 'https://www.mintlify.com/pricing',
  sourceLabel: 'mintlify.com/pricing',
  asOf: AS_OF,
  rows: [
    {
      plan: 'Starter',
      price: 'Free',
      includes: 'Full platform, custom domain, web editor, authentication, MCP server, API playground.',
    },
    {
      plan: 'Pro',
      price: '$450/month',
      includes: 'Everything in Starter, plus agent, assistant, automations, preview deployments, and admin APIs.',
    },
    {
      plan: 'Enterprise',
      price: 'Custom',
      includes:
        'SSO, SCIM & RBAC, performance SLA, advanced insights, enterprise security, migration, support, and a self-hosted custom frontend option.',
    },
  ],
  note: 'Mintlify meters AI features with credits — its pricing page lists 10,000 credits/month included and $0.01 per credit for overages. Its Enterprise self-hosting option covers a custom frontend; Mintlify still operates the content engine, editor, search, and AI services.',
};

const gitbookPricing: PricingTable = {
  productName: 'GitBook',
  sourceUrl: 'https://www.gitbook.com/pricing',
  sourceLabel: 'gitbook.com/pricing',
  asOf: AS_OF,
  rows: [
    {
      plan: 'Free',
      price: '$0 per site/month',
      includes: '1 user. Block-based editor, GitHub & GitLab sync, API playgrounds, preview deployments. No custom domain.',
    },
    {
      plan: 'Premium',
      price: '$65 per site/month + $12 per user/month',
      includes: 'Custom domain, AI search, advanced branding, analytics & user feedback, site redirects.',
    },
    {
      plan: 'Ultimate',
      price: '$249 per site/month + $12 per user/month',
      includes: 'Everything in Premium, plus AI assistant (500 answers included), authenticated access, adaptive content.',
    },
    {
      plan: 'Enterprise',
      price: 'Custom',
      includes: 'SAML SSO, white-glove migration, custom integrations, dedicated support.',
    },
  ],
  note: 'Annual billing is advertised as “2 months free”. Auto-updating translations are a paid add-on: $25 for the first 50,000 words, then $0.20 per 1,000 words.',
};

const readmePricing: PricingTable = {
  productName: 'ReadMe',
  sourceUrl: 'https://readme.com/pricing',
  sourceLabel: 'readme.com/pricing',
  asOf: AS_OF,
  rows: [
    {
      plan: 'Starter',
      price: 'Free',
      includes: '1 project, Markdown guides, API reference, 1 published version, custom domain, bi-directional sync, llms.txt, MCP server.',
    },
    {
      plan: 'Pro',
      price: '$250/month (billed annually)',
      includes: 'Unlimited projects and versions, branching and reviews, private docs, changelog, recipes, custom MDX components.',
    },
    {
      plan: 'Enterprise',
      price: 'Contact sales (annual billing)',
      includes: 'SSO/OAuth, audit logs, user roles and access control, no ReadMe branding, dedicated support, and on-premise deployment options.',
    },
  ],
  note: '“Ask AI” is a separate add-on at $150/month.',
};

const docusaurusPricing: PricingTable = {
  productName: 'Docusaurus',
  sourceUrl: 'https://docusaurus.io',
  sourceLabel: 'docusaurus.io',
  asOf: AS_OF,
  rows: [
    {
      plan: 'Docusaurus',
      price: 'Free',
      includes:
        'Open source under the MIT license. You pay only for wherever you host the static output — GitHub Pages, Netlify, or your own servers.',
    },
  ],
};

export const nibleafVsMintlify: Comparison = {
  slug: 'nibleaf-vs-mintlify',
  path: '/compare/nibleaf-vs-mintlify',
  competitorName: 'Mintlify',
  competitorUrl: 'https://www.mintlify.com',
  metaTitle: 'Nibleaf vs Mintlify: editor, pricing, RTL, and API docs',
  metaDescription:
    'Compare Nibleaf and Mintlify on pricing, editors, Markdown portability, Arabic/RTL, API tooling, and current self-hosting availability.',
  heading: 'Nibleaf vs Mintlify',
  breadcrumbName: 'Nibleaf vs Mintlify',
  directAnswer: [
    'Mintlify is a polished managed platform with strong API tooling and an Enterprise option for a self-hosted custom frontend. Nibleaf offers a visual editor over Markdown, a free cloud beta, Arabic/RTL support, and a public AGPL-3.0 full-stack self-hosted release.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: mintlifyPricing,
  features: [
    {
      feature: 'Public self-hosting',
      nibleaf: yes('AGPL-3.0 repository, pinned GHCR image, and Docker Compose installer'),
      competitor: partial('Enterprise custom frontend; content engine, editor, search, and AI remain managed services'),
    },
    {
      feature: 'WYSIWYG editor over plain Markdown',
      nibleaf: yes('Notion-style blocks; content stays Markdown'),
      competitor: yes('Web editor over MDX files'),
    },
    {
      feature: 'Free plan',
      nibleaf: yes('Cloud free during beta'),
      competitor: yes('Free Starter plan'),
    },
    { feature: 'Custom domains', nibleaf: yes(), competitor: yes('Included on free Starter') },
    {
      feature: 'Arabic & RTL with per-language page trees',
      nibleaf: yes('Built in from day one'),
      competitor: yes('Arabic and Hebrew layouts switch to RTL automatically'),
    },
    {
      feature: 'Built-in privacy-friendly analytics',
      nibleaf: yes('Product analytics; Cloudflare also processes hosted traffic'),
      competitor: partial('“Advanced insights” is listed under Enterprise'),
    },
    {
      feature: 'Markdown export & portability',
      nibleaf: yes('Plain Markdown, take it anywhere'),
      competitor: yes('Content lives as MDX files'),
    },
    { feature: 'llms.txt for AI assistants', nibleaf: yes('Generated per published site'), competitor: yes() },
    {
      feature: 'OpenAPI playground / API try-it',
      nibleaf: yes('OpenAPI 3.x references powered by Scalar'),
      competitor: yes('Included on free Starter'),
    },
    { feature: 'Preview deployments', nibleaf: yes('Immutable previews for GitHub draft pull requests'), competitor: yes('Pro plan') },
    { feature: 'Changelog RSS', nibleaf: yes('RSS 2.0 feed for every published changelog'), competitor: yes('Subscribable changelog feed') },
    {
      feature: 'Real-time multi-user editing',
      nibleaf: no('Comments and Git review are available; live co-editing and presence are not'),
      competitor: yes('Real-time collaboration in the web editor'),
    },
    {
      feature: 'Git providers and multi-repository projects',
      nibleaf: partial('Two-way GitHub workflow; public GitLab and generic Git imports are one-way'),
      competitor: yes('GitHub, GitLab, Bitbucket, and Enterprise multi-repo workflows'),
    },
    {
      feature: 'Custom components, CSS, and JavaScript',
      nibleaf: partial('Curated portable MDX components and branding controls; arbitrary runtime code is not accepted'),
      competitor: yes('Custom components plus CSS and JavaScript customization'),
    },
    {
      feature: 'Reader personalization and adaptive content',
      nibleaf: partial('Private readers, audiences, page grants, and JWT group mapping without adaptive content'),
      competitor: yes('Authentication, personalization, and adaptive content options'),
    },
    {
      feature: 'Third-party integrations and platform webhooks',
      nibleaf: partial('GA4, Plausible, Git webhooks, and API access'),
      competitor: yes('Broad analytics, support, webhook, and websocket integrations'),
    },
    {
      feature: 'AI assistant & agent',
      nibleaf: partial(
        'Grounded answers and read-only MCP are in source main; provider setup is optional and the v0.1.2 artifact does not include them',
      ),
      competitor: yes('Pro plan, metered by credits'),
    },
    { feature: 'SSO / SCIM / organization audit logs', nibleaf: planned(), competitor: yes('Enterprise plan') },
  ],
  pickCompetitor: {
    title: 'When to pick Mintlify instead',
    reasons: [
      'You want an AI assistant and agent built into your docs (metered by credits on their side).',
      'You need real-time co-editing, GitLab or Bitbucket two-way workflows, or a multi-repository documentation project.',
      'You need arbitrary custom components and runtime CSS or JavaScript, adaptive content, or a broad catalog of managed integrations.',
      'You need SSO, SCIM, and enterprise compliance guarantees today.',
    ],
  },
  pickNibleaf: {
    title: 'When to pick Nibleaf',
    reasons: [
      'You want a browser editor over exportable Markdown and prefer either a managed beta or a public full-stack Compose deployment.',
      'Your writers prefer a Notion-style WYSIWYG editor over editing MDX files — while the content stays plain Markdown.',
      'You want an RTL-aware editor and dedicated Arabic search behavior in addition to localized navigation and reader layout.',
      'You want built-in reader analytics and accept Cloudflare processing on the managed service.',
      'You want plain-Markdown export and the option to run the full stack from public source and container artifacts.',
    ],
  },
  verdict: [
    'Mintlify is the more mature product today. Its free Starter plan is genuinely generous — custom domain, web editor, and an API playground — and its AI tooling is ahead of most of the market. It also supports Arabic/RTL and offers Enterprise teams a self-hosted custom frontend while retaining its managed content and AI services.',
    'Nibleaf is strongest on full-stack self-hosting, browser-based Markdown editing, multilingual and RTL authoring, a focused bidirectional GitHub workflow, and self-hostable OpenAPI references powered by Scalar. Mintlify remains ahead on real-time collaboration, provider breadth, custom runtime components, integrations, personalization, and enterprise identity governance.',
  ],
  faqs: [
    {
      q: 'Is Nibleaf a good alternative to Mintlify?',
      a: 'It can be, if you value browser-based Markdown editing and Arabic/RTL support. Nibleaf Cloud covers editing, versioned publishing, search, custom domains, and analytics during its free beta, and the AGPL-3.0 release can be self-hosted. Mintlify remains ahead on API tooling.',
    },
    {
      q: 'Is Mintlify open source?',
      a: 'The Mintlify platform is a closed-source hosted product, although some components are open source. Nibleaf’s public repository and container release are licensed under AGPL-3.0 and can be installed with Docker Compose.',
    },
    {
      q: 'How much does Mintlify cost?',
      a: 'As of August 17, 2026, Mintlify has a free Starter plan, Pro at $450/month, and custom-priced Enterprise. AI features are metered with credits — 10,000/month included, then $0.01 per credit. See mintlify.com/pricing for current numbers.',
    },
    {
      q: 'Can I migrate docs from Mintlify to Nibleaf?',
      a: 'Yes. Nibleaf imports public GitHub repositories that contain docs.json or mint.json and maps navigation, pages, and site branding. The 500-node limit counts both groups and pages, and any remaining entries are skipped. Unsupported components stay in the imported MDX for manual review because Nibleaf cannot guarantee that Mintlify-specific rendering will carry over.',
    },
    {
      q: 'What does Nibleaf not have yet compared to Mintlify?',
      a: 'Excluding AI, Nibleaf does not yet provide live multi-user co-editing, two-way GitLab or Bitbucket and multi-repository workflows, arbitrary runtime components or JavaScript, adaptive content, Mintlify’s breadth of integrations, or Enterprise SAML SSO and SCIM. Nibleaf does provide audiences, JWT reader handoff, GitHub draft-PR previews, exports, and changelog RSS.',
    },
  ],
};

export const nibleafVsGitbook: Comparison = {
  slug: 'nibleaf-vs-gitbook',
  path: '/compare/nibleaf-vs-gitbook',
  competitorName: 'GitBook',
  competitorUrl: 'https://www.gitbook.com',
  metaTitle: 'Nibleaf vs GitBook — pricing and features, honestly compared',
  metaDescription:
    'Nibleaf vs GitBook: current pricing, editors, git workflow, Arabic/RTL, Markdown portability, and verified self-hosting availability.',
  heading: 'Nibleaf vs GitBook',
  breadcrumbName: 'Nibleaf vs GitBook',
  directAnswer: [
    'GitBook is a polished hosted docs platform priced per site plus per user. Nibleaf is a documentation platform with a free cloud beta, Markdown export, and Arabic/RTL support. GitBook also publishes its reader renderer under GPLv3, but its workspace and editor remain part of the hosted service.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: gitbookPricing,
  features: [
    {
      feature: 'Public self-hosting',
      nibleaf: yes('AGPL-3.0 repository, pinned GHCR image, and Docker Compose installer'),
      competitor: partial('GPLv3 published-site renderer; not the full workspace'),
    },
    {
      feature: 'WYSIWYG block editor',
      nibleaf: yes('Notion-style; persists plain Markdown'),
      competitor: yes('Block-based editor'),
    },
    {
      feature: 'Custom domain on the free plan',
      nibleaf: yes('Included in the free beta'),
      competitor: no('From Premium — $65 per site/month'),
    },
    {
      feature: 'No per-seat fees',
      nibleaf: yes('Cloud is free during beta'),
      competitor: no('$12 per user/month on paid plans'),
    },
    {
      feature: 'Arabic & RTL with per-language page trees',
      nibleaf: yes('Built in from day one'),
      competitor: partial('Paragraphs and headings auto-align; GitBook says other RTL contribution blocks are not fully supported'),
    },
    { feature: 'Built-in analytics', nibleaf: yes('Included, privacy-friendly'), competitor: partial('From Premium') },
    {
      feature: 'Markdown export & portability',
      nibleaf: yes('Plain Markdown, take it anywhere'),
      competitor: yes('Via GitHub/GitLab sync'),
    },
    {
      feature: 'llms.txt for AI assistants',
      nibleaf: yes('Generated per published site'),
      competitor: yes('Also provides llms-full.txt, per-page Markdown, and MCP'),
    },
    {
      feature: 'Two-way git sync',
      nibleaf: partial('GitHub authoring with draft pull requests; GitLab remains one-way'),
      competitor: yes('GitHub & GitLab, on the free plan'),
    },
    { feature: 'API playground', nibleaf: yes('OpenAPI 3.x references powered by Scalar'), competitor: yes('On the free plan') },
    { feature: 'Preview deployments', nibleaf: yes('Immutable previews for GitHub draft pull requests'), competitor: yes('On the free plan') },
    {
      feature: 'Reader authentication & adaptive content',
      nibleaf: partial('Invitations, JWT handoff, and page-scoped access; no adaptive personalization'),
      competitor: yes('Ultimate plan'),
    },
    {
      feature: 'AI search & assistant',
      nibleaf: partial('Optional hybrid retrieval and grounded answers are in source main; they require operator configuration and project opt-in'),
      competitor: yes('Search from Premium; assistant from Ultimate'),
    },
    { feature: 'SAML SSO', nibleaf: planned(), competitor: yes('Enterprise plan') },
  ],
  pickCompetitor: {
    title: 'When to pick GitBook instead',
    reasons: [
      'You need two-way GitLab sync today — Nibleaf’s two-way workflow currently targets GitHub.',
      'You need adaptive reader personalization rather than invitations, JWT handoff, and page-scoped access.',
      'You want a hosted AI assistant that is already operated for you, without configuring and evaluating optional retrieval and answer providers.',
      'You need SAML SSO or GitBook’s mature enterprise governance today.',
    ],
  },
  pickNibleaf: {
    title: 'When to pick Nibleaf',
    reasons: [
      'You want a custom domain without paying $65 per site/month plus $12 per user/month (GitBook Premium pricing as of August 17, 2026).',
      'You need the full editor, publishing pipeline, and reader to be deployable together. GitBook self-hosts only its published-site renderer.',
      'You need complete Arabic/RTL authoring support; GitBook says only paragraphs and headings currently auto-align reliably.',
      'You want your content to stay plain Markdown you can export and move any time.',
      'You want built-in analytics without upgrading to a paid tier.',
    ],
  },
  verdict: [
    'GitBook is a capable hosted product with git sync, API playgrounds, and preview deployments on the free plan, plus reader authentication and AI features on higher tiers. Its published-site renderer is open source and can be self-hosted, but GitBook says that path is not recommended or supported and it does not include the hosted workspace and editor.',
    'Nibleaf Cloud covers WYSIWYG editing over Markdown, versioned publishing, search, custom domains, analytics, Arabic/RTL, GitHub pull-request previews, private readers, and Scalar OpenAPI references. Source main also includes optional hybrid retrieval, grounded answers, and read-only MCP, but the published v0.1.2 self-hosted artifact does not. If you need two-way GitLab sync, adaptive content, a fully operated hosted assistant, or SAML today, GitBook is the safer fit.',
  ],
  faqs: [
    {
      q: 'Is Nibleaf a good alternative to GitBook?',
      a: 'It can be for teams that want a block-style editor over Markdown, Arabic/RTL support, full-stack self-hosting, GitHub pull-request previews, and private readers. Nibleaf includes custom domains and analytics in its free cloud beta, while GitBook gates custom domains behind Premium at $65 per site/month plus $12 per user/month as of August 17, 2026. GitBook is ahead on GitLab sync, adaptive content, AI features, and enterprise SSO.',
    },
    {
      q: 'How much does GitBook cost?',
      a: 'As of August 17, 2026: Free ($0, 1 user, no custom domain), Premium at $65 per site/month plus $12 per user/month, Ultimate at $249 per site/month plus $12 per user/month, and custom-priced Enterprise with SAML SSO. Annual billing is advertised as two months free. See gitbook.com/pricing for current numbers.',
    },
    {
      q: 'Can I self-host GitBook?',
      a: 'GitBook’s GPLv3 published-site renderer can be self-hosted, but GitBook says this is not its recommended or supported path. The hosted workspace and editor are not included. Nibleaf publishes its full AGPL-3.0 stack, a pinned GHCR image, and a Docker Compose installer for self-hosting.',
    },
    {
      q: 'Does Nibleaf have git sync like GitBook?',
      a: 'Yes for GitHub. Nibleaf can commit browser edits to a dedicated branch, create or update a draft pull request, reconcile upstream changes, and publish an immutable noindex preview. Existing GitLab connections remain one-way today.',
    },
    {
      q: 'Which is better for Arabic or RTL documentation?',
      a: 'Nibleaf treats Arabic/RTL as a first-class feature: per-language page trees, RTL-aware editor and reader UI, and bilingual search. GitBook’s help center says paragraphs and headings can auto-align for RTL text, but lists and other blocks may not align correctly.',
    },
  ],
};

export const nibleafVsDocusaurus: Comparison = {
  slug: 'nibleaf-vs-docusaurus',
  path: '/compare/nibleaf-vs-docusaurus',
  competitorName: 'Docusaurus',
  competitorUrl: 'https://docusaurus.io',
  metaTitle: 'Nibleaf vs Docusaurus: docs platform vs static site',
  metaDescription:
    'Nibleaf vs Docusaurus: browser-based docs platform versus static docs-as-code, compared on editing, search, hosting, Arabic/RTL, and ownership.',
  heading: 'Nibleaf vs Docusaurus',
  breadcrumbName: 'Nibleaf vs Docusaurus',
  directAnswer: [
    'Docusaurus is a free, MIT-licensed static site generator whose MDX source lives in Git. Nibleaf is a documentation platform with a WYSIWYG editor, publishing, search, analytics, a free cloud beta, and a public AGPL-3.0 self-hosted release.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: docusaurusPricing,
  features: [
    { feature: 'Open source', nibleaf: yes('AGPL-3.0'), competitor: yes('MIT') },
    {
      feature: 'WYSIWYG editor for non-developers',
      nibleaf: yes('Notion-style blocks over plain Markdown'),
      competitor: no('MDX edited in your code editor'),
    },
    {
      feature: 'Hosted option',
      nibleaf: yes('Free cloud beta at nibleaf.com'),
      competitor: no('You build and deploy the static output yourself'),
    },
    {
      feature: 'Publish without a build pipeline',
      nibleaf: yes('Publish straight from the editor'),
      competitor: no('Node.js build on every deploy'),
    },
    {
      feature: 'Built-in search',
      nibleaf: partial('Built-in Orama path; optional Qdrant hybrid path is in source main but not the v0.1.2 artifact'),
      competitor: partial('Typically the Algolia integration or community plugins'),
    },
    {
      feature: 'i18n incl. RTL',
      nibleaf: yes('Per-language page trees, Arabic-first'),
      competitor: yes('i18n out of the box; RTL locales supported'),
    },
    {
      feature: 'Versioning',
      nibleaf: yes('Every publish is a snapshot'),
      competitor: yes('Docs versioning built in'),
    },
    { feature: 'Custom domains', nibleaf: yes(), competitor: yes('Via whatever host you deploy to') },
    { feature: 'Built-in reader analytics', nibleaf: yes('Privacy-friendly, no tracker'), competitor: no('Bring your own') },
    {
      feature: 'Full code-level theme control (React)',
      nibleaf: partial('Theming, branding, and MDX components — not arbitrary code'),
      competitor: yes('It is a React codebase you own'),
    },
    {
      feature: 'OpenAPI playground / API try-it',
      nibleaf: yes('OpenAPI 3.x references powered by Scalar'),
      competitor: partial('Via community plugins'),
    },
    {
      feature: 'Docs-as-code with git and PR reviews',
      nibleaf: partial('Two-way GitHub authoring with draft pull requests and immutable previews'),
      competitor: yes('Your repo is the source of truth'),
    },
  ],
  pickCompetitor: {
    title: 'When to pick Docusaurus instead',
    reasons: [
      'Your writers are developers and your docs already live in a git repo with PR reviews.',
      'You want full code-level control: it is a React/MDX codebase, so any customization is possible.',
      'You want free static hosting anywhere (GitHub Pages, Netlify, your own CDN) with no platform in the loop.',
      'You rely on its plugin ecosystem — Algolia search, OpenAPI plugins, blogs, and more.',
    ],
  },
  pickNibleaf: {
    title: 'When to pick Nibleaf',
    reasons: [
      'Non-developers write your docs: Nibleaf gives them a Notion-style WYSIWYG editor, no git or Node.js required.',
      'You want instant publishing with versioned snapshots instead of a build-and-deploy pipeline.',
      'You want search and reader analytics built in, without wiring up Algolia or an analytics service.',
      'You want a managed option in free beta with custom domains and do not require immediate self-hosting.',
      'You need Arabic/RTL editing in the authoring UI itself, not just in the rendered output.',
    ],
  },
  verdict: [
    'Docusaurus is excellent at what it does. If engineers are happy in Git and want control of a React codebase, it costs nothing and has a mature public distribution.',
    'Nibleaf trades some of that code-level control for a platform normal humans can operate: a real editor, one-click publishing, built-in search and analytics, and a hosted option. Teams often outgrow docs-as-code in the other direction — when product managers, support, and technical writers need to contribute without a pull request. That is the case Nibleaf is built for.',
  ],
  faqs: [
    {
      q: 'Is Docusaurus free?',
      a: 'Yes. Docusaurus is open source under the MIT license (its documentation is CC-BY-4.0). You pay only for hosting the static output, which can be free on services like GitHub Pages.',
    },
    {
      q: 'What is the difference between Nibleaf and Docusaurus?',
      a: 'Docusaurus is a static site generator: content is MDX in Git, and developers build and deploy the site. Nibleaf is a documentation platform with a WYSIWYG editor over Markdown, versioned publishing, built-in search and analytics, a free cloud beta, and a public AGPL-3.0 self-hosted release.',
    },
    {
      q: 'Does Docusaurus support Arabic and RTL?',
      a: 'Yes — the Docusaurus i18n docs state that right-to-left locales such as Arabic and Hebrew are supported. Nibleaf additionally makes the authoring experience RTL-aware: per-language page trees and an editor that handles RTL text natively.',
    },
    {
      q: 'Can I self-host Nibleaf and Docusaurus?',
      a: 'A Docusaurus site is static files you can serve from any web server or CDN. Nibleaf is a full-stack application with public source, a pinned container release, and a guided Docker Compose installer.',
    },
    {
      q: 'Which is better for non-developers?',
      a: 'Nibleaf. Contributors write in a Notion-style WYSIWYG editor and publish from the browser. With Docusaurus, contributors edit MDX files and changes go through git and a build pipeline.',
    },
  ],
};

/** One-line, fair descriptions reused across the /alternatives roundups. */
const nibleafAlternativeEntry = (_vs: string): AlternativeEntry => ({
  name: 'Nibleaf',
  url: '/',
  isNibleaf: true,
  description: `${ENTITY_SENTENCE} Full disclosure: Nibleaf is our product. Source main includes two-way GitHub authoring, pull-request previews, private reader access, Scalar-powered OpenAPI references, optional hybrid retrieval and grounded answers, and read-only MCP. It still lacks SAML/SCIM and adaptive content; the published v0.1.2 self-hosted artifact predates the latest capability set.`,
  bestFor: 'Teams that want a managed browser editor, Markdown export, and first-class Arabic/RTL during the free cloud beta.',
});

const docusaurusEntry: AlternativeEntry = {
  name: 'Docusaurus',
  url: 'https://docusaurus.io',
  description:
    'Free, MIT-licensed static site generator from Meta. Write MDX in your repo, embed React components, and get versioning and i18n (including RTL locales) out of the box; you build and host the output yourself.',
  bestFor: 'Developer teams that want docs-as-code with full control of a React codebase.',
};

const starlightEntry: AlternativeEntry = {
  name: 'Starlight',
  url: 'https://starlight.astro.build',
  description:
    'Free, open-source documentation theme built on Astro. Markdown, Markdoc, or MDX in; a fast static site with search, i18n, and dark mode out.',
  bestFor: 'Fast static docs sites with minimal setup, especially if you already like Astro.',
};

const scalarEntry: AlternativeEntry = {
  name: 'Scalar',
  url: 'https://scalar.com',
  description:
    'API-first documentation: interactive references generated from OpenAPI/AsyncAPI documents, Markdown/MDX guides, and two-way git sync. Its API client is open source, and hosted plans are available.',
  bestFor: 'Teams whose documentation is primarily an API reference.',
};

const gitbookEntry: AlternativeEntry = {
  name: 'GitBook',
  url: 'https://www.gitbook.com',
  description:
    'Polished hosted docs platform with a block-based editor and GitHub/GitLab sync. Free for one user without a custom domain; custom domains from $65 per site/month plus $12 per user/month, as of August 17, 2026.',
  bestFor: 'Teams that want a managed, all-in-one docs tool and are happy with SaaS pricing.',
};

const mintlifyEntry: AlternativeEntry = {
  name: 'Mintlify',
  url: 'https://www.mintlify.com',
  description:
    'Managed documentation platform with a generous free Starter plan (custom domain, web editor, API playground) and paid Pro/Enterprise plans that add AI features, previews, SSO, and an Enterprise self-hosted custom frontend option, as of August 17, 2026.',
  bestFor: 'API-heavy startup docs where AI tooling and an API playground matter most.',
};

export const mintlifyAlternatives: AlternativesRoundup = {
  slug: 'mintlify',
  path: '/alternatives/mintlify',
  competitorName: 'Mintlify',
  competitorUrl: 'https://www.mintlify.com',
  metaTitle: 'Mintlify alternatives: 5 hosted and open-source tools (2026)',
  metaDescription: 'Compare five Mintlify alternatives by editor, API workflow, hosting, Arabic/RTL, pricing, and verified public availability.',
  heading: 'Mintlify alternatives',
  breadcrumbName: 'Mintlify alternatives',
  directAnswer: [
    'The best Mintlify alternative depends on the workflow. Nibleaf offers a WYSIWYG Markdown editor, Arabic/RTL support, a free cloud beta, and a public self-hosted release. Docusaurus and Starlight are static generators, Scalar is API-first, and GitBook is another hosted editor.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: mintlifyPricing,
  alternatives: [nibleafAlternativeEntry('Mintlify'), docusaurusEntry, starlightEntry, scalarEntry, gitbookEntry],
  faqs: [
    {
      q: 'What is the best open-source alternative to Mintlify?',
      a: 'Docusaurus or Starlight are strong open-source choices if you prefer a static generator and docs-as-code. Nibleaf is the full-stack option: its public AGPL-3.0 repository and pinned container release install with Docker Compose.',
    },
    {
      q: 'What is the best free alternative to Mintlify?',
      a: 'Docusaurus and Starlight are free software, with hosting costs determined by where you deploy the static output. Nibleaf Cloud is free while in beta. Mintlify itself has a free Starter plan, so compare workflows and limits rather than price alone.',
    },
    {
      q: 'Why would I switch away from Mintlify?',
      a: 'Common reasons are wanting a different ownership model, a static docs-as-code workflow, exportable Markdown in a browser editor, or stronger Arabic/RTL support. If none apply, Mintlify remains a strong product.',
    },
    {
      q: 'Is Nibleaf really free?',
      a: 'Nibleaf Cloud is free while in beta, with fair-use limits and no credit card. No paid cloud plan is currently offered. The self-hosted release is free under AGPL-3.0; operators pay only for their own infrastructure and services.',
    },
  ],
};

export const gitbookAlternatives: AlternativesRoundup = {
  slug: 'gitbook',
  path: '/alternatives/gitbook',
  competitorName: 'GitBook',
  competitorUrl: 'https://www.gitbook.com',
  metaTitle: 'GitBook alternatives: 5 open-source and hosted tools (2026)',
  metaDescription: 'Compare five GitBook alternatives by editor, Git workflow, hosting, custom domains, pricing, and verified public availability.',
  heading: 'GitBook alternatives',
  breadcrumbName: 'GitBook alternatives',
  directAnswer: [
    'If you like GitBook’s block editor but want a different ownership or pricing model, compare the authoring workflow first. Nibleaf provides a browser editor and Markdown export, Docusaurus and Starlight are static docs-as-code options, Scalar is API-first, and Mintlify is the closest hosted developer-docs platform. GitBook itself also offers a self-hostable GPLv3 reader renderer, though not its full workspace.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: gitbookPricing,
  alternatives: [nibleafAlternativeEntry('GitBook'), docusaurusEntry, starlightEntry, scalarEntry, mintlifyEntry],
  faqs: [
    {
      q: 'What is the best open-source alternative to GitBook?',
      a: 'Docusaurus and Starlight are strong open-source choices if you prefer a static generator. Nibleaf is closer to GitBook’s browser-editor workflow and provides both a free cloud beta and a public AGPL-3.0 self-hosted release.',
    },
    {
      q: 'What is the cheapest GitBook alternative with a custom domain?',
      a: 'GitBook gates custom domains behind Premium at $65 per site/month plus $12 per user/month as of August 17, 2026. Nibleaf includes custom domains in its free cloud beta, and Mintlify’s free Starter plan includes one. Static generators support custom domains through the host you choose.',
    },
    {
      q: 'Can I self-host a GitBook alternative?',
      a: 'Yes. Docusaurus and Starlight produce static files you can host anywhere. GitBook’s GPLv3 renderer can publish a self-hosted reader, but not the complete hosted workspace. Nibleaf publishes its full AGPL-3.0 stack, a pinned GHCR image, and a Docker Compose installer.',
    },
    {
      q: 'What does Nibleaf lack compared to GitBook?',
      a: 'As of August 2026, Nibleaf’s remaining gaps include two-way GitLab authoring, adaptive content, SAML SSO, and a published self-host image for the capabilities currently merged in source main. The source tree includes optional hybrid retrieval and grounded answers plus read-only MCP; providers and project opt-in remain explicit.',
    },
  ],
};

export const readmeAlternatives: AlternativesRoundup = {
  slug: 'readme',
  path: '/alternatives/readme',
  competitorName: 'ReadMe',
  competitorUrl: 'https://readme.com',
  metaTitle: 'ReadMe alternatives: 5 API and product-docs options (2026)',
  metaDescription: 'Compare five ReadMe alternatives by API tooling, editor, product guides, hosting, pricing, and verified public availability.',
  heading: 'ReadMe alternatives',
  breadcrumbName: 'ReadMe alternatives',
  directAnswer: [
    'ReadMe is strongest as a hosted API-reference hub. Nibleaf combines guides, product docs, browser editing, Arabic/RTL, and Scalar-powered OpenAPI references across Cloud and self-hosted deployment.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: readmePricing,
  alternatives: [nibleafAlternativeEntry('ReadMe'), scalarEntry, mintlifyEntry, docusaurusEntry, starlightEntry],
  faqs: [
    {
      q: 'What is the best open-source alternative to ReadMe?',
      a: 'For API references, Scalar has an open-source client and generates references from OpenAPI documents; Docusaurus covers this through community plugins. Nibleaf’s public AGPL-3.0 release includes Scalar-powered OpenAPI references alongside its guide editor.',
    },
    {
      q: 'How much does ReadMe cost?',
      a: 'As of August 17, 2026: a free Starter plan (1 project, API reference, custom domain), Pro at $250/month billed annually, and custom-priced Enterprise. The “Ask AI” add-on is $150/month. See readme.com/pricing for current numbers.',
    },
    {
      q: 'Does Nibleaf have an interactive API reference like ReadMe?',
      a: 'Yes. Nibleaf validates OpenAPI 3.x documents, publishes generated endpoint and schema pages with Scalar, and includes browser-based API try-it alongside guides and bilingual Arabic/English documentation.',
    },
    {
      q: 'Is Nibleaf really free?',
      a: 'Nibleaf Cloud is free while in beta, with fair-use limits and no credit card. No paid cloud plan is currently offered. The self-hosted release is free under AGPL-3.0; operators pay for their own infrastructure and services.',
    },
  ],
};

export const comparisons = [nibleafVsMintlify, nibleafVsGitbook, nibleafVsDocusaurus];
export const roundups = [mintlifyAlternatives, gitbookAlternatives, readmeAlternatives];
