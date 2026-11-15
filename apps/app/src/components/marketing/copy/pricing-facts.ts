import { CAPABILITY_AVAILABILITY, compareReleases, type RolloutCapability } from './availability';

/**
 * The facts the English and Arabic pricing pages both state, kept in one place
 * so the two languages can't drift: what each option costs, the license, the
 * self-hosted release the AI and support rows ship in, and so on. The copy
 * modules interpolate these and never retype them.
 */

/** The AI, search and support capabilities behind the pricing table's "Included in …" cells. */
const PRICING_TABLE_CAPABILITIES: RolloutCapability[] = ['askAi', 'readerSearch', 'supportMcp', 'docsInsights', 'bringYourOwnKey'];

export const PRICING_FACTS = {
  /** What each option costs today, in US dollars: Cloud during the beta, and the self-hosted software. */
  priceUsd: { cloud: 0, selfHosted: 0 },
  license: 'AGPL-3.0',
  /** The first published self-hosted release with every capability above (`availability.ts`). */
  selfHostedRelease: PRICING_TABLE_CAPABILITIES.map((capability) => CAPABILITY_AVAILABILITY[capability].selfHostedSince ?? '').reduce(
    (latest, tag) => (compareReleases(tag, latest) > 0 ? tag : latest),
    '',
  ),
  /** Interface locales the dashboard ships (packages/i18n/messages). */
  interfaceLocales: 12,
  supportEmail: 'support@nibleaf.com',
} as const;

/** A price as both pages print it: `$0`, in Western digits as the Arabic pages use. */
export const formatUsd = (amount: number) => `$${amount}`;
