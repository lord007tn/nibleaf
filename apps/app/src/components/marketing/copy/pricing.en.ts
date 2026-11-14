import { 'marketing.release.searchCapability' as releaseSearchCapability } from '@nibleaf/i18n/messages';
import { marketingFaqs } from '@/lib/marketing-faqs';
import { PRICING_FACTS } from './pricing-facts';
import type { PricingCopy } from './types';

const { license, selfHostedRelease: release, interfaceLocales, supportEmail } = PRICING_FACTS;

export const pricingEn: PricingCopy = {
  meta: {
    title: 'Nibleaf pricing: free cloud beta and self-hosting status',
    description: `Nibleaf Cloud is free during the beta, with no card at sign-up. The ${license} release can be self-hosted with Docker Compose.`,
    breadcrumb: ['Home', 'Pricing'],
  },
  header: {
    eyebrow: 'Pricing',
    title: 'Free while in beta. Self-host when you prefer.',
    body: `Nibleaf Cloud is free during the beta with no card at sign-up. The ${license} self-hosted release provides source and Docker Compose deployment configuration. Check release assets and prerequisites before installing.`,
  },
  cloud: {
    name: 'Cloud',
    badge: 'Fastest start',
    priceNote: 'free during beta — no credit card',
    points: [
      'Hosted dashboard and docs sites',
      'Managed database, queues, and storage',
      'Automatic deploys and upgrades',
      'Custom domains and analytics',
      'No paid cloud plan offered today',
    ],
    cta: { label: 'Create free account', href: '/sign-up' },
    footnote: 'No credit card. Create a project and publish from your browser.',
  },
  selfHosted: {
    name: 'Self-hosted',
    priceNote: `${license} software; infrastructure costs are yours`,
    points: [
      'Guided Docker Compose installer',
      'PostgreSQL and S3-compatible storage',
      'Docker Compose and Coolify configurations',
      'Public source and release deployment configuration',
      'You manage DNS, TLS, backups, and upgrades',
    ],
    cta: { label: 'View self-hosting guide', href: '/self-hosting' },
  },
  included: {
    eyebrow: "What's included",
    title: 'Same core product, different operations',
    lead: 'Writing, publishing, built-in search, custom domains, and Arabic/RTL are core capabilities in both.',
    notes: [
      `The AI and support rows are available on Nibleaf Cloud and in self-hosted ${release}.`,
      'Reader themes, the newer search features, and hybrid retrieval are available the same way.',
      'MCP can draft, edit, move, translate, set visibility, and publish only after a confirmed preview, with OAuth sign-in or expiring personal keys.',
      'The editor writing assistant uses the instance key.',
    ],
    includedLabel: 'Included',
    groups: [
      {
        title: 'Authoring',
        rows: [
          { label: 'Notion-style editor over plain Markdown', cloud: true, self: true },
          { label: 'MDX components (callouts, tabs, code groups)', cloud: true, self: true },
          { label: 'Review comments on supported block anchors', cloud: true, self: true },
          {
            label: 'Sites, pages, and members',
            cloud: 'No published page/seat plan cap; safeguards apply',
            self: 'Infrastructure and feature limits apply',
          },
        ],
      },
      {
        title: 'Publishing',
        rows: [
          { label: 'Versioned, immutable publishes', cloud: true, self: true },
          { label: 'Custom domains with guided DNS', cloud: true, self: true },
          { label: 'Wildcard project subdomains', cloud: true, self: true },
        ],
      },
      {
        title: 'Search, SEO & analytics',
        rows: [
          { label: releaseSearchCapability({}, { locale: 'en' }), cloud: true, self: true },
          { label: 'Section links, recent searches, and cross-language results', cloud: true, self: `Included in ${release}` },
          { label: 'SSR, canonicals, JSON-LD, sitemaps; hreflang for linked indexable translations', cloud: true, self: true },
          { label: 'Product analytics', cloud: 'Included; Cloudflare also processes hosted traffic', self: true },
        ],
      },
      {
        title: 'AI and support',
        rows: [
          {
            label: 'Ask AI reader chat with section citations',
            cloud: 'Included; per-site opt-in',
            self: `Included in ${release}; needs an AI provider key (workspace or instance), site opt-in and the Qdrant service`,
          },
          { label: 'Workspace OpenAI/OpenRouter keys', cloud: true, self: `Included in ${release}; needs the credential encryption key` },
          {
            label: 'Support MCP with Read only, Support writer, and Full admin presets',
            cloud: true,
            self: `Included in ${release}; off by default`,
          },
          { label: 'Docs-owner insights', cloud: true, self: `Included in ${release}; needs optional ClickHouse` },
        ],
      },
      {
        title: 'Languages',
        rows: [
          {
            label: `English and Arabic authoring with RTL; ${interfaceLocales} interface locales, with some strings still in English`,
            cloud: true,
            self: true,
          },
          { label: 'Per-language page trees', cloud: true, self: true },
        ],
      },
      {
        title: 'Infrastructure',
        rows: [
          { label: 'Hosting', cloud: 'Managed for you', self: 'Your servers' },
          { label: 'Database & storage', cloud: 'Managed Postgres + storage', self: 'Your Postgres; operator-configured S3-compatible storage' },
          { label: 'Upgrades', cloud: 'Automatic', self: 'Pull the new release and follow its upgrade notes' },
          {
            label: 'Data ownership',
            cloud: 'Markdown/MDX export; verify destination components',
            self: 'You choose hosting and external service destinations',
          },
          { label: 'Support', cloud: supportEmail, self: 'Community support and your own operations' },
        ],
      },
    ],
  },
  finePrint: {
    eyebrow: 'The fine print, up front',
    title: 'What “free beta” actually means',
    items: [
      {
        title: 'Free beta, no card at sign-up',
        body: 'There is nothing to cancel and no trial clock. Sign up, write, publish — the beta is simply free.',
      },
      {
        title: 'Fair use with feature safeguards',
        body: 'No page or seat plan cap is published for the beta. AI request/token budgets, import/export limits, and operator quotas still apply.',
      },
      {
        title: 'No paid cloud plan today',
        body: `Future prices, launch dates, and beta discounts are not specified here. Self-hosted software is available under ${license}; you cover infrastructure and external services.`,
      },
    ],
  },
  faq: { eyebrow: 'FAQ', title: 'Frequently asked', items: marketingFaqs },
  finalCta: {
    title: 'Start with the free Cloud beta.',
    body: 'Evaluate the editor and publishing workflow now, or review the deployment checklist for your own infrastructure.',
    primary: { label: 'Create free account', href: '/sign-up' },
    secondary: { label: 'Self-hosting guide', href: '/self-hosting' },
  },
};
