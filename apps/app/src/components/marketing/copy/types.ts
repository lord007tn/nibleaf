/**
 * Typed copy contract for the public marketing site.
 *
 * Marketing copy lives in these TypeScript modules (one file per language)
 * rather than the 12-locale Paraglide catalog because:
 * - the marketing site ships English and Arabic only, so the other ten
 *   interface catalogs never carry placeholder marketing keys;
 * - each page imports only its own language module inside its code-split
 *   component, so no marketing string reaches the public docs reader or the
 *   dashboard, and marketing pages never load the full interface catalog;
 * - Arabic is written as Arabic, section by section, not key by key.
 *
 * Rules for every string in these files: it must be true of the current main
 * branch, never name a version as current, never invent customers, numbers,
 * reviews or logos, and never promise roadmap work as shipped. Capability
 * availability on Nibleaf Cloud is worded only through `availability.ts`.
 */

import type { RolloutCapability } from './availability';

export type MarketingLang = 'en' | 'ar';

export interface Cta {
  label: string;
  href: string;
}

interface NavLink extends Cta {
  external?: boolean;
}

/** Keys into the media manifest (`media/manifest.ts`). Copy supplies the alt text. */
export type MarketingMediaKey = 'hero-chat' | 'chat' | 'search' | 'insights' | 'mcp' | 'editor' | 'dashboard' | 'arabic' | 'themes';

export interface MediaRef {
  key: MarketingMediaKey;
  /** Describes what the screenshot shows, in the page language. */
  alt: string;
  /** Optional one-line caption shown under the media (for example what the demo content is). */
  caption?: string;
}

/** Icon names for compact feature grids; components map them to lucide icons. */
export type MarketingIcon =
  | 'ai'
  | 'search'
  | 'insights'
  | 'mcp'
  | 'editor'
  | 'languages'
  | 'themes'
  | 'domains'
  | 'versions'
  | 'git'
  | 'exports'
  | 'api'
  | 'private'
  | 'llms'
  | 'seo'
  | 'key'
  | 'storage'
  | 'feedback'
  | 'openSource'
  | 'server'
  | 'cloud'
  | 'shield'
  | 'support'
  | 'team';

export interface ShellCopy {
  skipToContent: string;
  homeLabel: string;
  primaryNavLabel: string;
  nav: NavLink[];
  login: Cta;
  start: Cta;
  /** Link to the same page in the other language. `href` is filled per page by the shell. */
  languageSwitch: { label: string; ariaLabel: string; hrefLang: MarketingLang };
  theme: { toDark: string; toLight: string };
  menu: { open: string; close: string; title: string };
  github: { label: string; starsLabel: (count: number) => string };
  footer: {
    tagline: string;
    openSource: { badge: string; heading: string; body: string };
    columns: { title: string; links: NavLink[] }[];
    legalLine: (year: number) => string;
    licenseLabel: string;
    sourceLabel: string;
  };
}

interface FeatureSection {
  /** Stable anchor id, e.g. `ask-ai`. */
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  /** Honest prerequisite or scope note, e.g. that answers need an AI provider key. */
  note?: string;
  /** Label shown before `note`: what kind of note it is (requirements, availability…). */
  noteLabel?: string;
  cta?: Cta;
  media: MediaRef;
}

export interface PathCard {
  name: string;
  price: string;
  priceNote: string;
  points: string[];
  cta: Cta;
  footnote: string;
}

export interface LandingCopy {
  meta: { title: string; description: string; ogImageAlt: string };
  hero: {
    eyebrow: string;
    title: string;
    subtitle: string;
    primaryCta: Cta;
    secondaryCta: Cta;
    /** Low-key text link, e.g. to Nibleaf's own docs, which run on Nibleaf. */
    tertiaryLink: Cta;
    assurances: string[];
    /** Availability caption under the hero while new capabilities roll out (from `availability.ts`). */
    availabilityNote?: string;
    media: MediaRef;
  };
  /** Verifiable trust signals only. Every item links to its proof where one exists. */
  proof: { label: string; items: { icon: MarketingIcon; title: string; body: string; href?: string }[] };
  features: FeatureSection[];
  more: {
    eyebrow: string;
    title: string;
    body: string;
    /** `availability` marks a capability that is still rolling out; its note renders with the item and Cloud-only lists leave it out. */
    items: { icon: MarketingIcon; title: string; body: string; availability?: RolloutCapability }[];
  };
  howItWorks: { eyebrow: string; title: string; body: string; steps: { title: string; body: string }[] };
  paths: { eyebrow: string; title: string; body: string; cloud: PathCard; selfHost: PathCard; detailsLink: Cta };
  compare: { eyebrow: string; title: string; body: string; links: (Cta & { description: string })[] };
  faq: { eyebrow: string; title: string; items: { q: string; a: string }[] };
  blog: { eyebrow: string; title: string; allLink: Cta; readingTime: (minutes: number) => string };
  finalCta: { title: string; body: string; primary: Cta; secondary: Cta };
}
