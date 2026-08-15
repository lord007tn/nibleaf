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
      plan: 'Self-hosted distribution',
      price: 'Currently unavailable publicly',
      includes: 'AGPL-3.0 codebase and full-stack Compose design. Anonymous repository and container access must be restored before installation works.',
    },
  ],
  note: 'No paid cloud plan is currently offered. Check the self-hosting status page before planning infrastructure.',
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
  metaTitle: 'Nibleaf vs Mintlify: editor, pricing, RTL, and API docs',
  metaDescription:
    'Compare Nibleaf and Mintlify on pricing, editors, Markdown portability, Arabic/RTL, API tooling, and current self-hosting availability.',
  heading: 'Nibleaf vs Mintlify',
  breadcrumbName: 'Nibleaf vs Mintlify',
  directAnswer: [
    'Mintlify is a polished hosted platform with strong API tooling. Nibleaf offers a visual editor over Markdown, a free cloud beta, and Arabic/RTL support. Its codebase is AGPL-3.0, but public source and container distribution is currently unavailable, so do not choose it for immediate self-hosting.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: mintlifyPricing,
  features: [
    {
      feature: 'Public self-hosting',
      nibleaf: partial('AGPL-3.0 codebase; public artifacts currently inaccessible'),
      competitor: no('Hosted platform'),
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
      competitor: unknown('Not listed on their pricing page — see their docs'),
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
      nibleaf: planned('Documented gap; no committed date'),
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
      'You want a browser editor over exportable Markdown and are comfortable using the managed beta while public distribution is unavailable.',
      'Your writers prefer a Notion-style WYSIWYG editor over editing MDX files — while the content stays plain Markdown.',
      'You publish documentation in Arabic or another RTL language and want per-language page trees, not an afterthought.',
      'You want built-in reader analytics and accept Cloudflare processing on the managed service.',
      'You want plain-Markdown export and a documented path toward running the full stack after public artifacts become accessible.',
    ],
  },
  verdict: [
    'Mintlify is the more mature product today. Its free Starter plan is genuinely generous — custom domain, web editor, and an API playground — and its AI tooling is ahead of most of the market. If your documentation is API-first and you are comfortable with a closed, hosted platform, it is a strong choice.',
    'Nibleaf is strongest on browser-based Markdown editing and Arabic/RTL authoring. Its public distribution is not usable today, and its OpenAPI playground, preview deployments, and SSO remain documented gaps. Choose the Cloud beta only if those limits are acceptable.',
  ],
  faqs: [
    {
      q: 'Is Nibleaf a good alternative to Mintlify?',
      a: 'It can be, if you value browser-based Markdown editing and Arabic/RTL support. Nibleaf Cloud covers editing, versioned publishing, search, custom domains, and analytics during its free beta. Mintlify is ahead on API tooling, and Nibleaf public self-hosting is currently unavailable.',
    },
    {
      q: 'Is Mintlify open source?',
      a: 'The Mintlify platform is a closed-source hosted product, although some components are open source. Nibleaf’s codebase is AGPL-3.0, but its repository and container package must become anonymously accessible before public self-hosting works.',
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
      a: 'As of August 2026, Nibleaf does not ship an OpenAPI playground/API try-it, two-way git sync with PR previews, reader authentication or personalization, or SSO/SAML. These are documented gaps without committed delivery dates.',
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
      nibleaf: partial('AGPL-3.0 codebase; public image access must be restored'),
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
      competitor: unknown('Paid auto-translation add-on exists; see their docs for RTL'),
    },
    { feature: 'Built-in analytics', nibleaf: yes('Included, privacy-friendly'), competitor: partial('From Premium') },
    {
      feature: 'Markdown export & portability',
      nibleaf: yes('Plain Markdown, take it anywhere'),
      competitor: yes('Via GitHub/GitLab sync'),
    },
    { feature: 'llms.txt for AI assistants', nibleaf: yes('Generated per published site'), competitor: unknown('See their docs') },
    { feature: 'Two-way git sync', nibleaf: planned('Documented gap; track in GitHub issues'), competitor: yes('GitHub & GitLab, on the free plan') },
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
      'You need the full editor, publishing pipeline, and reader to be deployable together after Nibleaf’s public image access is restored. GitBook self-hosts only its published-site renderer.',
      'You write documentation in Arabic or another RTL language and want per-language page trees built in, not a paid translation add-on.',
      'You want your content to stay plain Markdown you can export and move any time.',
      'You want built-in analytics without upgrading to a paid tier.',
    ],
  },
  verdict: [
    'GitBook is a capable hosted product with git sync, API playgrounds, and preview deployments on the free plan, plus reader authentication and AI features on higher tiers. Its published-site renderer is open source and can be self-hosted, but GitBook says that path is not recommended or supported and it does not include the hosted workspace and editor.',
    'Nibleaf Cloud covers WYSIWYG editing over Markdown, versioned publishing, search, custom domains, analytics, and Arabic/RTL during its free beta. Its public full-stack distribution is not currently installable. If you need GitBook’s git sync or reader authentication today, GitBook is the safer fit.',
  ],
  faqs: [
    {
      q: 'Is Nibleaf a good alternative to GitBook?',
      a: 'It can be for teams that want a block-style editor over Markdown and Arabic/RTL support. Nibleaf includes custom domains and analytics in its free cloud beta, while GitBook gates custom domains behind Premium at $65 per site/month plus $12 per user/month as of July 2026. GitBook is ahead on git sync, reader authentication, AI features, and currently verifiable distribution.',
    },
    {
      q: 'How much does GitBook cost?',
      a: 'As of July 2026: Free ($0, 1 user, no custom domain), Premium at $65 per site/month plus $12 per user/month, Ultimate at $249 per site/month plus $12 per user/month, and custom-priced Enterprise with SAML SSO. Annual billing is advertised as two months free. See gitbook.com/pricing for current numbers.',
    },
    {
      q: 'Can I self-host GitBook?',
      a: 'GitBook’s GPLv3 published-site renderer can be self-hosted, but GitBook says this is not its recommended or supported path. The hosted workspace and editor are not included. Nibleaf is designed to deploy the full stack, but its public repository and container image must be anonymously accessible before the public installation path is usable.',
    },
    {
      q: 'Does Nibleaf have git sync like GitBook?',
      a: 'Not yet. Two-way git sync with PR previews is a documented gap. Today, Nibleaf stores Markdown in its database and exports Markdown in a ZIP; it is not a live Git repository.',
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
    'Nibleaf vs Docusaurus: browser-based docs platform versus static docs-as-code, compared on editing, search, hosting, Arabic/RTL, and ownership.',
  heading: 'Nibleaf vs Docusaurus',
  breadcrumbName: 'Nibleaf vs Docusaurus',
  directAnswer: [
    'Docusaurus is a free, MIT-licensed static site generator whose MDX source lives in Git. Nibleaf is a managed documentation platform with a WYSIWYG editor, publishing, search, analytics, and a free cloud beta. Nibleaf’s codebase is AGPL-3.0, but its public installation artifacts are not currently accessible.',
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
      nibleaf: planned('Documented gap; no committed date'),
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
      a: 'Docusaurus is a static site generator: content is MDX in Git, and developers build and deploy the site. Nibleaf is a managed documentation platform with a WYSIWYG editor over Markdown, versioned publishing, built-in search and analytics, and a free cloud beta. Its AGPL-3.0 public installation path is currently unavailable.',
    },
    {
      q: 'Does Docusaurus support Arabic and RTL?',
      a: 'Yes — the Docusaurus i18n docs state that right-to-left locales such as Arabic and Hebrew are supported. Nibleaf additionally makes the authoring experience RTL-aware: per-language page trees and an editor that handles RTL text natively.',
    },
    {
      q: 'Can I self-host Nibleaf and Docusaurus?',
      a: 'A Docusaurus site is static files you can serve from any web server or CDN. Nibleaf has a full-stack Compose design, but its repository and container image must become anonymously accessible before a new public user can install it.',
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
  description: `${ENTITY_SENTENCE} Full disclosure: Nibleaf is our product. Compared with ${vs}, it lacks an OpenAPI playground, two-way git sync, reader authentication, and SSO/SAML. Its public source and container distribution is also unavailable today.`,
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
  metaTitle: 'Mintlify alternatives: 5 hosted and open-source options (2026)',
  metaDescription:
    'Compare five Mintlify alternatives by editor, API workflow, hosting, Arabic/RTL, pricing, and verified public availability.',
  heading: 'Mintlify alternatives',
  breadcrumbName: 'Mintlify alternatives',
  directAnswer: [
    'The best Mintlify alternative depends on the workflow. Nibleaf Cloud offers a WYSIWYG Markdown editor and Arabic/RTL support, but its public self-hosting distribution is currently unavailable. Docusaurus and Starlight are public static generators, Scalar is API-first, and GitBook is another hosted editor.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: mintlifyPricing,
  alternatives: [nibleafAlternativeEntry('Mintlify'), docusaurusEntry, starlightEntry, scalarEntry, gitbookEntry],
  faqs: [
    {
      q: 'What is the best open-source alternative to Mintlify?',
      a: 'Docusaurus or Starlight are the verifiable open-source choices today if you prefer a static generator and docs-as-code. Nibleaf’s codebase is AGPL-3.0, but its public repository and container package are not anonymously accessible, so its self-hosting path is not ready.',
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
      a: 'Nibleaf Cloud is free while in beta, with fair-use limits and no credit card. No paid cloud plan is currently offered. Public self-hosting is unavailable until anonymous source and container access is restored.',
    },
  ],
};

export const gitbookAlternatives: AlternativesRoundup = {
  slug: 'gitbook',
  path: '/alternatives/gitbook',
  competitorName: 'GitBook',
  competitorUrl: 'https://www.gitbook.com',
  metaTitle: 'GitBook alternatives: 5 open-source and hosted options (2026)',
  metaDescription:
    'Compare five GitBook alternatives by editor, Git workflow, hosting, custom domains, pricing, and verified public availability.',
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
      a: 'Docusaurus and Starlight are the clearest publicly installable open-source choices if you prefer a static generator. Nibleaf Cloud is closer to GitBook’s browser-editor workflow, but its AGPL-3.0 source and container distribution is currently unavailable publicly.',
    },
    {
      q: 'What is the cheapest GitBook alternative with a custom domain?',
      a: 'GitBook gates custom domains behind Premium at $65 per site/month plus $12 per user/month as of July 2026. Nibleaf includes custom domains in its free cloud beta, and Mintlify’s free Starter plan includes one. Static generators support custom domains through the host you choose.',
    },
    {
      q: 'Can I self-host a GitBook alternative?',
      a: 'Yes. Docusaurus and Starlight produce static files you can host anywhere. GitBook’s GPLv3 renderer can publish a self-hosted reader, but not the complete hosted workspace. Nibleaf is designed for full-stack self-hosting, though its public source and image access must be restored before anonymous installation works.',
    },
    {
      q: 'What does Nibleaf lack compared to GitBook?',
      a: 'As of August 2026: two-way git sync, an API playground, preview deployments, reader authentication/adaptive content, and SAML SSO. These are documented gaps rather than committed roadmap dates. GitBook ships them on various tiers.',
    },
  ],
};

export const readmeAlternatives: AlternativesRoundup = {
  slug: 'readme',
  path: '/alternatives/readme',
  competitorName: 'ReadMe',
  competitorUrl: 'https://readme.com',
  metaTitle: 'ReadMe alternatives: 5 API and product-docs options (2026)',
  metaDescription:
    'Compare five ReadMe alternatives by API tooling, editor, product guides, hosting, pricing, and verified public availability.',
  heading: 'ReadMe alternatives',
  breadcrumbName: 'ReadMe alternatives',
  directAnswer: [
    'ReadMe is strongest as a hosted API-reference hub. Scalar and Mintlify are closer for interactive API references. Nibleaf Cloud focuses on guides, product docs, browser editing, and Arabic/RTL, but it lacks an API playground and its public self-hosting distribution is currently unavailable.',
    ENTITY_SENTENCE,
  ],
  competitorPricing: readmePricing,
  alternatives: [nibleafAlternativeEntry('ReadMe'), scalarEntry, mintlifyEntry, docusaurusEntry, starlightEntry],
  faqs: [
    {
      q: 'What is the best open-source alternative to ReadMe?',
      a: 'For API references, Scalar has an open-source client and generates references from OpenAPI documents; Docusaurus covers this through community plugins. Nibleaf’s codebase is AGPL-3.0, but it is not currently a publicly installable choice because its source and image distribution is inaccessible.',
    },
    {
      q: 'How much does ReadMe cost?',
      a: 'As of July 2026: a free Starter plan (1 project, API reference, custom domain), Pro at $250/month billed annually, and Enterprise from $3,000/month. The “Ask AI” add-on is $150/month. See readme.com/pricing for current numbers.',
    },
    {
      q: 'Does Nibleaf have an interactive API reference like ReadMe?',
      a: 'Not yet. An OpenAPI playground/API try-it is a documented gap without a committed date. If interactive API reference is the primary need, Scalar or Mintlify are closer fits; Nibleaf is focused on guides, product docs, and bilingual Arabic/English documentation.',
    },
    {
      q: 'Is Nibleaf really free?',
      a: 'Nibleaf Cloud is free while in beta, with fair-use limits and no credit card. No paid cloud plan is currently offered. Public self-hosting is unavailable until anonymous source and container access is restored.',
    },
  ],
};

export const comparisons = [nibleafVsMintlify, nibleafVsGitbook, nibleafVsDocusaurus];
export const roundups = [mintlifyAlternatives, gitbookAlternatives, readmeAlternatives];
