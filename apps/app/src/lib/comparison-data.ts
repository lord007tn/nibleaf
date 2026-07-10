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
export const AS_OF = 'July 2026';

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
const unknown = (note?: string): FeatureCell => ({ value: 'unknown', note });

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
      price: 'Free forever',
      includes: 'The entire open-source stack (AGPL-3.0) with one docker compose — no feature gates, your database and storage.',
    },
  ],
  note: 'Paid cloud plans will come after the beta, announced with generous advance notice. Self-hosting stays free forever.',
};

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
      price: 'Paid — see their pricing page',
      includes: 'Everything in Starter, plus agent, assistant, automations, preview deployments, and admin APIs.',
    },
    {
      plan: 'Enterprise',
      price: 'Custom',
      includes: 'SSO, SCIM & RBAC, performance SLA, advanced insights, enterprise security & legal, migration & support.',
    },
  ],
  note: 'Mintlify meters AI features with credits — its pricing page lists 10,000 credits/month included and $0.01 per credit for overages. The Pro price is rendered dynamically on their page, so we link to it rather than quote a number that could go stale.',
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
      price: 'From $3,000/month (annual billing)',
      includes: 'SSO/OAuth, audit logs, user roles and access control, no ReadMe branding, dedicated support.',
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
  metaTitle: 'Nibleaf vs Mintlify — the open-source alternative, compared',
  metaDescription:
    'An honest Nibleaf vs Mintlify comparison: pricing, feature matrix, and where each wins. Nibleaf is open source and self-hostable; Mintlify has the more mature API tooling today.',
  heading: 'Nibleaf vs Mintlify',
  breadcrumbName: 'Nibleaf vs Mintlify',
  directAnswer: [
    'Mintlify is a polished, hosted documentation platform; Nibleaf is the open-source alternative you can run yourself. Pick Nibleaf if you want a Notion-style editor over plain Markdown, first-class Arabic/RTL support, and the freedom to self-host under AGPL-3.0. Pick Mintlify if you need an OpenAPI playground, AI assistant, or preview deployments today — Nibleaf has not shipped those yet.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: mintlifyPricing,
  features: [
    {
      feature: 'Open source & self-hostable',
      nibleaf: yes('AGPL-3.0, one docker compose'),
      competitor: no('Hosted platform'),
    },
    {
      feature: 'WYSIWYG editor over plain Markdown',
      nibleaf: yes('Notion-style blocks; content stays Markdown'),
      competitor: yes('Web editor over MDX files'),
    },
    {
      feature: 'Free plan',
      nibleaf: yes('Cloud free during beta; self-hosting free forever'),
      competitor: yes('Free Starter plan'),
    },
    { feature: 'Custom domains', nibleaf: yes(), competitor: yes('Included on free Starter') },
    {
      feature: 'Arabic & RTL with per-language page trees',
      nibleaf: yes('Built in from day one'),
      competitor: unknown('Not listed on their pricing page — see their docs'),
    },
    {
      feature: 'Built-in privacy-friendly analytics',
      nibleaf: yes('No third-party trackers'),
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
      nibleaf: planned('On the public roadmap'),
      competitor: yes('Included on free Starter'),
    },
    { feature: 'Preview deployments', nibleaf: planned(), competitor: yes('Pro plan') },
    { feature: 'AI assistant & agent', nibleaf: no('Not a current focus'), competitor: yes('Pro plan, metered by credits') },
    { feature: 'SSO / SCIM', nibleaf: planned(), competitor: yes('Enterprise plan') },
  ],
  pickCompetitor: {
    title: 'When to pick Mintlify instead',
    reasons: [
      'You need an OpenAPI playground and API try-it today — Nibleaf’s is still on the roadmap.',
      'You want an AI assistant and agent built into your docs (metered by credits on their side).',
      'You need preview deployments for every change right now.',
      'You need SSO, SCIM, and enterprise compliance guarantees today.',
    ],
  },
  pickNibleaf: {
    title: 'When to pick Nibleaf',
    reasons: [
      'You want to own your docs platform: Nibleaf is AGPL-3.0 open source and self-hosts with one docker compose. Mintlify is hosted-only.',
      'Your writers prefer a Notion-style WYSIWYG editor over editing MDX files — while the content stays plain Markdown.',
      'You publish documentation in Arabic or another RTL language and want per-language page trees, not an afterthought.',
      'You want built-in, privacy-friendly reader analytics without adding a third-party tracker.',
      'You want a docs stack with no vendor lock-in: open code, plain-Markdown export, your own storage if you self-host.',
    ],
  },
  verdict: [
    'Mintlify is the more mature product today. Its free Starter plan is genuinely generous — custom domain, web editor, and an API playground — and its AI tooling is ahead of most of the market. If your documentation is API-first and you are comfortable with a closed, hosted platform, it is a strong choice.',
    'Nibleaf wins on ownership and writing experience: the entire platform is open source, self-hosting is free forever, the editor is a real WYSIWYG over plain Markdown, and Arabic/RTL is first-class rather than an afterthought. The gaps — OpenAPI playground, preview deployments, SSO — are disclosed above and tracked publicly on GitHub. If those gaps are not blockers for you, Nibleaf gives you the same core docs workflow without lock-in.',
  ],
  faqs: [
    {
      q: 'Is Nibleaf a good alternative to Mintlify?',
      a: 'Yes, if you value open source and self-hosting over breadth of features. Nibleaf covers the core docs workflow — WYSIWYG Markdown editing, versioned publishing, search, custom domains, analytics — and is free (cloud beta and self-hosted). Mintlify is currently ahead on API tooling: OpenAPI playground, AI assistant, and preview deployments.',
    },
    {
      q: 'Is Mintlify open source?',
      a: 'The Mintlify platform is a closed-source hosted product, although some of its components are open source. Nibleaf’s entire platform is open source under AGPL-3.0 and can be self-hosted with one docker compose.',
    },
    {
      q: 'How much does Mintlify cost?',
      a: 'As of July 2026, Mintlify has a free Starter plan (custom domain, web editor, authentication, MCP server, API playground), a paid Pro plan, and custom-priced Enterprise. AI features are metered with credits — 10,000/month included, then $0.01 per credit. See mintlify.com/pricing for current numbers.',
    },
    {
      q: 'Can I migrate docs from Mintlify to Nibleaf?',
      a: 'There is no one-click importer yet. Both tools keep content as Markdown/MDX, so migration is mostly moving Markdown into Nibleaf pages; Mintlify-specific MDX components need adjusting to Nibleaf’s component set.',
    },
    {
      q: 'What does Nibleaf not have yet compared to Mintlify?',
      a: 'As of July 2026, Nibleaf does not yet ship an OpenAPI playground/API try-it, two-way git sync with PR previews, reader authentication or personalization, or SSO/SAML. All of these are tracked on the public roadmap at github.com/lord007tn/nibleaf.',
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
    'Nibleaf vs GitBook: what each costs as of July 2026, a feature matrix, and where each wins. Nibleaf is open source with free self-hosting; GitBook is a polished hosted platform priced per site and per user.',
  heading: 'Nibleaf vs GitBook',
  breadcrumbName: 'Nibleaf vs GitBook',
  directAnswer: [
    'GitBook is a polished hosted docs platform priced per site plus per user; Nibleaf is the open-source alternative with a free cloud beta and free self-hosting. Pick Nibleaf for ownership, plain-Markdown portability, and Arabic/RTL documentation. Pick GitBook if you need git sync, reader authentication, or its AI features today.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: gitbookPricing,
  features: [
    { feature: 'Open source & self-hostable', nibleaf: yes('AGPL-3.0, one docker compose'), competitor: no('Hosted platform') },
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
      nibleaf: yes('Free beta; self-hosting free forever'),
      competitor: no('$12 per user/month on paid plans'),
    },
    {
      feature: 'Arabic & RTL with per-language page trees',
      nibleaf: yes('Built in from day one'),
      competitor: unknown('Paid auto-translation add-on exists; see their docs for RTL'),
    },
    { feature: 'Built-in analytics', nibleaf: yes('Included, privacy-friendly'), competitor: partial('From Premium') },
    {
      feature: 'Markdown export & portability',
      nibleaf: yes('Plain Markdown, take it anywhere'),
      competitor: yes('Via GitHub/GitLab sync'),
    },
    { feature: 'llms.txt for AI assistants', nibleaf: yes('Generated per published site'), competitor: unknown('See their docs') },
    { feature: 'Two-way git sync', nibleaf: planned('On the public roadmap'), competitor: yes('GitHub & GitLab, on the free plan') },
    { feature: 'API playground', nibleaf: planned(), competitor: yes('On the free plan') },
    { feature: 'Preview deployments', nibleaf: planned(), competitor: yes('On the free plan') },
    { feature: 'Reader authentication & adaptive content', nibleaf: planned(), competitor: yes('Ultimate plan') },
    { feature: 'AI search & assistant', nibleaf: no('Not a current focus'), competitor: yes('Search from Premium; assistant from Ultimate') },
    { feature: 'SAML SSO', nibleaf: planned(), competitor: yes('Enterprise plan') },
  ],
  pickCompetitor: {
    title: 'When to pick GitBook instead',
    reasons: [
      'You need two-way GitHub/GitLab sync today — it is included even on their free plan.',
      'You need authenticated access or adaptive content for readers (their Ultimate plan).',
      'You want AI search and an AI assistant answering questions from your docs now.',
      'You want preview deployments and API playgrounds without waiting on Nibleaf’s roadmap.',
    ],
  },
  pickNibleaf: {
    title: 'When to pick Nibleaf',
    reasons: [
      'You want a custom domain without paying $65 per site/month plus $12 per user/month (GitBook Premium pricing as of July 2026).',
      'You want to self-host: Nibleaf is AGPL-3.0 open source; GitBook’s current platform is cloud-only.',
      'You write documentation in Arabic or another RTL language and want per-language page trees built in, not a paid translation add-on.',
      'You want your content to stay plain Markdown you can export and move any time.',
      'You want built-in analytics without upgrading to a paid tier.',
    ],
  },
  verdict: [
    'GitBook is an excellent hosted product with a serious feature set: git sync, API playgrounds, and preview deployments on the free plan, plus reader authentication and AI features on higher tiers. The trade-offs are price — a custom domain starts at $65 per site/month plus $12 per user/month as of July 2026 — and that it is a closed platform you cannot run yourself.',
    'Nibleaf covers the everyday docs workflow — WYSIWYG editing over Markdown, versioned publishing, search, custom domains, analytics — for free, in the open, with Arabic/RTL as a first-class citizen. If you need GitBook’s git sync or reader auth today, use GitBook; if you want ownership and a lower bill, Nibleaf is built for exactly that.',
  ],
  faqs: [
    {
      q: 'Is Nibleaf a good alternative to GitBook?',
      a: 'Yes, for teams that want an open-source, self-hostable platform with a block-style editor over plain Markdown. Nibleaf includes custom domains and analytics for free (cloud beta and self-hosted), while GitBook gates custom domains behind Premium at $65 per site/month plus $12 per user/month as of July 2026. GitBook is ahead on git sync, reader authentication, and AI features.',
    },
    {
      q: 'How much does GitBook cost?',
      a: 'As of July 2026: Free ($0, 1 user, no custom domain), Premium at $65 per site/month plus $12 per user/month, Ultimate at $249 per site/month plus $12 per user/month, and custom-priced Enterprise with SAML SSO. Annual billing is advertised as two months free. See gitbook.com/pricing for current numbers.',
    },
    {
      q: 'Can I self-host GitBook?',
      a: 'GitBook’s current platform is offered as a hosted service — its pricing page lists only cloud plans as of July 2026. Nibleaf is open source under AGPL-3.0 and self-hosts with one docker compose.',
    },
    {
      q: 'Does Nibleaf have git sync like GitBook?',
      a: 'Not yet. Two-way git sync with PR previews is on Nibleaf’s public roadmap (github.com/lord007tn/nibleaf). Today, Nibleaf content is plain Markdown that you can export at any time.',
    },
    {
      q: 'Which is better for Arabic or RTL documentation?',
      a: 'Nibleaf treats Arabic/RTL as a first-class feature: per-language page trees, RTL-aware editor and reader UI, and bilingual search. GitBook offers a paid auto-translation add-on ($25 for the first 50,000 words, then $0.20 per 1,000 words as of July 2026); check their docs for current RTL support.',
    },
  ],
};

export const nibleafVsDocusaurus: Comparison = {
  slug: 'nibleaf-vs-docusaurus',
  path: '/compare/nibleaf-vs-docusaurus',
  competitorName: 'Docusaurus',
  competitorUrl: 'https://docusaurus.io',
  metaTitle: 'Nibleaf vs Docusaurus — docs platform vs static site generator',
  metaDescription:
    'Nibleaf vs Docusaurus: both open source, very different shapes. Docusaurus is a free MIT static site generator for docs-as-code; Nibleaf is a full platform with a WYSIWYG Markdown editor, hosting, search, and analytics.',
  heading: 'Nibleaf vs Docusaurus',
  breadcrumbName: 'Nibleaf vs Docusaurus',
  directAnswer: [
    'Docusaurus and Nibleaf are both open source, but they solve documentation differently. Docusaurus is a free, MIT-licensed static site generator: your docs live as MDX in a git repo, and developers build and deploy the site. Nibleaf is a full documentation platform — editor, publishing, search, analytics, and hosting — that non-developers can use through a WYSIWYG editor, available as a free cloud beta or self-hosted.',
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
      nibleaf: yes('Full-text + fuzzy (Orama), no external service'),
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
      nibleaf: planned('On the public roadmap'),
      competitor: partial('Via community plugins'),
    },
    {
      feature: 'Docs-as-code with git and PR reviews',
      nibleaf: planned('Two-way git sync is on the roadmap'),
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
      'You want a managed option (the free cloud beta) with custom domains — or the same stack self-hosted.',
      'You need Arabic/RTL editing in the authoring UI itself, not just in the rendered output.',
    ],
  },
  verdict: [
    'This is the friendliest comparison on this site: both projects are open source, and Docusaurus is excellent at what it does. If you have engineers who are happy in git and want total control of a React codebase, Docusaurus costs nothing and will not limit you.',
    'Nibleaf trades some of that code-level control for a platform normal humans can operate: a real editor, one-click publishing, built-in search and analytics, and a hosted option. Teams often outgrow docs-as-code in the other direction — when product managers, support, and technical writers need to contribute without a pull request. That is the case Nibleaf is built for.',
  ],
  faqs: [
    {
      q: 'Is Docusaurus free?',
      a: 'Yes. Docusaurus is open source under the MIT license (its documentation is CC-BY-4.0). You pay only for hosting the static output, which can be free on services like GitHub Pages.',
    },
    {
      q: 'What is the difference between Nibleaf and Docusaurus?',
      a: 'Docusaurus is a static site generator: content is MDX in a git repo, and developers build and deploy the site. Nibleaf is a documentation platform: a WYSIWYG editor over plain Markdown, versioned publishing, built-in search and analytics, and hosting — free cloud beta or self-hosted (AGPL-3.0).',
    },
    {
      q: 'Does Docusaurus support Arabic and RTL?',
      a: 'Yes — the Docusaurus i18n docs state that right-to-left locales such as Arabic and Hebrew are supported. Nibleaf additionally makes the authoring experience RTL-aware: per-language page trees and an editor that handles RTL text natively.',
    },
    {
      q: 'Can I self-host both Nibleaf and Docusaurus?',
      a: 'Yes. A Docusaurus site is static files you can serve from any web server or CDN. Nibleaf is a full platform (app, API, worker, database, storage) that self-hosts with one docker compose under AGPL-3.0.',
    },
    {
      q: 'Which is better for non-developers?',
      a: 'Nibleaf. Contributors write in a Notion-style WYSIWYG editor and publish from the browser. With Docusaurus, contributors edit MDX files and changes go through git and a build pipeline.',
    },
  ],
};

/** One-line, fair descriptions reused across the /alternatives roundups. */
const nibleafAlternativeEntry = (vs: string): AlternativeEntry => ({
  name: 'Nibleaf',
  url: '/',
  isNibleaf: true,
  description: `${ENTITY_SENTENCE} Full disclosure: Nibleaf is our product — and compared to ${vs} it does not yet have an OpenAPI playground, two-way git sync, reader authentication, or SSO/SAML. The roadmap is public on GitHub.`,
  bestFor: 'Teams that want an open-source, self-hostable docs platform with a WYSIWYG Markdown editor and first-class Arabic/RTL.',
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
    'Polished hosted docs platform with a block-based editor and GitHub/GitLab sync. Free for one user without a custom domain; custom domains from $65 per site/month plus $12 per user/month, as of July 2026.',
  bestFor: 'Teams that want a managed, all-in-one docs tool and are happy with SaaS pricing.',
};

const mintlifyEntry: AlternativeEntry = {
  name: 'Mintlify',
  url: 'https://www.mintlify.com',
  description:
    'Hosted documentation platform with a generous free Starter plan (custom domain, web editor, API playground) and paid Pro/Enterprise plans that add AI features, preview deployments, and SSO, as of July 2026.',
  bestFor: 'API-heavy startup docs where AI tooling and an API playground matter most.',
};

export const mintlifyAlternatives: AlternativesRoundup = {
  slug: 'mintlify',
  path: '/alternatives/mintlify',
  competitorName: 'Mintlify',
  competitorUrl: 'https://www.mintlify.com',
  metaTitle: 'The best Mintlify alternatives in 2026 (open source included)',
  metaDescription:
    'Five real Mintlify alternatives, honestly compared: Nibleaf (open source, self-hostable), Docusaurus, Starlight, Scalar, and GitBook — with current pricing and who each one is actually for.',
  heading: 'Mintlify alternatives',
  breadcrumbName: 'Mintlify alternatives',
  directAnswer: [
    'The best Mintlify alternative depends on what you are optimizing for. If you want an open-source, self-hostable platform with a WYSIWYG Markdown editor, that is Nibleaf — we build it, and we list what it still lacks below. If you want a free static site generator, look at Docusaurus or Starlight; if your docs are mostly an API reference, look at Scalar; if you want another polished hosted platform, look at GitBook.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: mintlifyPricing,
  alternatives: [nibleafAlternativeEntry('Mintlify'), docusaurusEntry, starlightEntry, scalarEntry, gitbookEntry],
  faqs: [
    {
      q: 'What is the best open-source alternative to Mintlify?',
      a: 'Nibleaf, if you want a full platform (editor, publishing, search, analytics, hosting) — it is AGPL-3.0 and self-hosts with one docker compose. Docusaurus or Starlight, if you prefer a static site generator and a docs-as-code workflow.',
    },
    {
      q: 'What is the best free alternative to Mintlify?',
      a: 'Docusaurus and Starlight are free forever (you pay only for static hosting, which can also be free). Nibleaf is free too: the cloud is free while in beta, and self-hosting is free forever. Note that Mintlify itself has a free Starter plan, so "free" alone may not be a reason to switch.',
    },
    {
      q: 'Why would I switch away from Mintlify?',
      a: 'Common reasons are wanting to self-host or own the platform (Mintlify is hosted-only), wanting content as plain Markdown in an editor non-developers can use, or needing first-class Arabic/RTL documentation. If none of those apply, Mintlify remains a strong product.',
    },
    {
      q: 'Is Nibleaf really free?',
      a: 'Yes. Nibleaf Cloud is free while in beta (fair-use limits, no credit card), and self-hosting the open-source AGPL-3.0 stack is free forever. Paid cloud plans will come later, announced with generous advance notice.',
    },
  ],
};

export const gitbookAlternatives: AlternativesRoundup = {
  slug: 'gitbook',
  path: '/alternatives/gitbook',
  competitorName: 'GitBook',
  competitorUrl: 'https://www.gitbook.com',
  metaTitle: 'The best GitBook alternatives in 2026 (open source included)',
  metaDescription:
    'Five real GitBook alternatives, honestly compared: Nibleaf (open source, block editor over Markdown), Docusaurus, Starlight, Scalar, and Mintlify — with current pricing and who each one is for.',
  heading: 'GitBook alternatives',
  breadcrumbName: 'GitBook alternatives',
  directAnswer: [
    'If you like GitBook’s block editor but not its per-site-plus-per-seat pricing or its closed platform, the closest alternative is Nibleaf: an open-source docs platform with a Notion-style editor over plain Markdown, free while in beta and free forever self-hosted — we build it, and its gaps are listed below. Docusaurus and Starlight are the strongest free static-site options, Scalar is the API-first pick, and Mintlify is the closest hosted-SaaS equivalent.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: gitbookPricing,
  alternatives: [nibleafAlternativeEntry('GitBook'), docusaurusEntry, starlightEntry, scalarEntry, mintlifyEntry],
  faqs: [
    {
      q: 'What is the best open-source alternative to GitBook?',
      a: 'Nibleaf is the closest like-for-like: a block-style WYSIWYG editor over plain Markdown, publishing, search, custom domains, and analytics — open source under AGPL-3.0 with free self-hosting. Docusaurus and Starlight are excellent if you prefer a static site generator.',
    },
    {
      q: 'What is the cheapest GitBook alternative with a custom domain?',
      a: 'GitBook gates custom domains behind Premium at $65 per site/month plus $12 per user/month as of July 2026. Nibleaf includes custom domains in its free beta and in free self-hosting. Mintlify’s free Starter plan also includes a custom domain. Static generators like Docusaurus support custom domains through whatever host you deploy to.',
    },
    {
      q: 'Can I self-host a GitBook alternative?',
      a: 'Yes. Nibleaf self-hosts with one docker compose (AGPL-3.0). Docusaurus and Starlight produce static files you can host anywhere. GitBook’s own current platform is cloud-only as of July 2026.',
    },
    {
      q: 'What does Nibleaf lack compared to GitBook?',
      a: 'As of July 2026: two-way git sync, an API playground, preview deployments, reader authentication/adaptive content, and SAML SSO. These are on the public roadmap at github.com/lord007tn/nibleaf. GitBook ships all of them today on various tiers.',
    },
  ],
};

export const readmeAlternatives: AlternativesRoundup = {
  slug: 'readme',
  path: '/alternatives/readme',
  competitorName: 'ReadMe',
  competitorUrl: 'https://readme.com',
  metaTitle: 'The best ReadMe alternatives in 2026 (open source included)',
  metaDescription:
    'Five real ReadMe alternatives, honestly compared: Nibleaf (open source, self-hostable), Scalar, Mintlify, Docusaurus, and Starlight — with current pricing and who each one is actually for.',
  heading: 'ReadMe alternatives',
  breadcrumbName: 'ReadMe alternatives',
  directAnswer: [
    'ReadMe is strongest as a hosted API-reference hub, so the right alternative depends on which half you need. For interactive API references, Scalar and Mintlify are the closest matches. For guides, knowledge bases, and product docs — especially if you want open source, self-hosting, or Arabic/RTL — Nibleaf is the strongest pick; we build it, and its API-reference gap is disclosed plainly below.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: readmePricing,
  alternatives: [nibleafAlternativeEntry('ReadMe'), scalarEntry, mintlifyEntry, docusaurusEntry, starlightEntry],
  faqs: [
    {
      q: 'What is the best open-source alternative to ReadMe?',
      a: 'For product docs and guides, Nibleaf: an AGPL-3.0 platform with a WYSIWYG Markdown editor, search, custom domains, and analytics, free to self-host. For the API-reference side specifically, Scalar has an open-source API client and generates references from OpenAPI documents; Docusaurus covers it with community plugins.',
    },
    {
      q: 'How much does ReadMe cost?',
      a: 'As of July 2026: a free Starter plan (1 project, API reference, custom domain), Pro at $250/month billed annually, and Enterprise from $3,000/month. The “Ask AI” add-on is $150/month. See readme.com/pricing for current numbers.',
    },
    {
      q: 'Does Nibleaf have an interactive API reference like ReadMe?',
      a: 'Not yet — an OpenAPI playground/API try-it is on Nibleaf’s public roadmap (github.com/lord007tn/nibleaf). If interactive API reference is your primary need today, Scalar or Mintlify are closer fits; Nibleaf is strongest for guides, product docs, and bilingual (Arabic/English) documentation.',
    },
    {
      q: 'Is Nibleaf really free?',
      a: 'Yes. Nibleaf Cloud is free while in beta (fair-use limits, no credit card), and self-hosting the open-source AGPL-3.0 stack is free forever. Paid cloud plans will come later, announced with generous advance notice.',
    },
  ],
};

export const comparisons = [nibleafVsMintlify, nibleafVsGitbook, nibleafVsDocusaurus];
export const roundups = [mintlifyAlternatives, gitbookAlternatives, readmeAlternatives];
