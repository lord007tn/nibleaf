import type { MarketingLang } from './types';

/**
 * The single place that says where recently merged capabilities are available.
 *
 * Merges to main do not deploy Nibleaf Cloud (production is a manual, pinned
 * deploy), and the owner has not yet confirmed the Cloud rollout of these
 * capabilities. Until they do, marketing copy describes them as product
 * capabilities and words their Cloud availability with `rolling-out`. Flip a
 * value to `live` only after the owner confirms the feature is enabled on
 * nibleaf.com; every page that mentions the capability picks the change up.
 */
type CloudAvailability = 'live' | 'rolling-out';

const CLOUD_AVAILABILITY = {
  askAi: 'rolling-out',
  /** The redesigned reader search (#281): section-level results, recent searches, the Ask AI hand-off. */
  readerSearch: 'rolling-out',
  supportMcp: 'rolling-out',
  docsInsights: 'rolling-out',
  bringYourOwnKey: 'rolling-out',
} as const satisfies Record<string, CloudAvailability>;

export type RolloutCapability = keyof typeof CLOUD_AVAILABILITY;

const NOTES: Record<CloudAvailability, Record<MarketingLang, string>> = {
  'rolling-out': {
    en: 'Available when you self-host today, and on Nibleaf Cloud as it rolls out.',
    ar: 'متاحة الآن عند الاستضافة الذاتية، وتصل إلى Nibleaf Cloud تدريجيًا.',
  },
  live: {
    en: 'Available on Nibleaf Cloud and when you self-host.',
    ar: 'متاحة على Nibleaf Cloud وعند الاستضافة الذاتية.',
  },
};

/** Short, honest availability sentence for one capability in one language. */
export function availabilityNote(capability: RolloutCapability, lang: MarketingLang): string {
  return NOTES[CLOUD_AVAILABILITY[capability]][lang];
}
