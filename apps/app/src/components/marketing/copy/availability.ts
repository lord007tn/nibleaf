import type { MarketingLang } from './types';

/**
 * The single place that says where recently merged capabilities are available.
 *
 * Two facts decide the wording, and neither follows from a merge to main:
 * - the self-hosted installer pulls the latest *published* release, so a
 *   capability reaches self-hosters only once a release that contains it ships;
 * - Nibleaf Cloud is a manual, pinned deploy, and the owner confirms its rollout.
 *
 * `in-source`: on main, not yet in a published self-hosted release or on Cloud.
 * `released`: in the published self-hosted release, still rolling out to Cloud.
 * `live`: in the published release and enabled on nibleaf.com.
 * Move a capability forward only when that is true; every page that mentions it
 * picks the change up.
 */
type Availability = 'in-source' | 'released' | 'live';

export type RolloutCapability =
  | 'askAi'
  | 'readerSearch'
  | 'supportMcp'
  | 'docsInsights'
  | 'bringYourOwnKey'
  | 'readerThemes'
  | 'gitbookImport'
  | 'readerAnalytics';

// Typed as the full union, not narrowed literals, so moving a value forward needs no other change.
const AVAILABILITY: Record<RolloutCapability, Availability> = {
  askAi: 'in-source',
  /** The redesigned reader search (#281): section-level results, recent searches, the Ask AI hand-off. */
  readerSearch: 'in-source',
  supportMcp: 'in-source',
  docsInsights: 'in-source',
  bringYourOwnKey: 'in-source',
  /** Harbor, Manuscript and Signal (#96, #101, #104): merged after the v0.1.2 release. */
  readerThemes: 'in-source',
  /** The GitBook Git Sync importer (#235). */
  gitbookImport: 'in-source',
  /** The ClickHouse reader-analytics pipeline (#97): consent linking, no IP storage, the two-visit search-term threshold. */
  readerAnalytics: 'in-source',
};

const NOTES: Record<Availability, Record<MarketingLang, string>> = {
  'in-source': {
    en: 'In the open-source code now; arriving in the next self-hosted release and on Nibleaf Cloud as it rolls out.',
    ar: 'موجودة الآن في الشيفرة المفتوحة المصدر، وتصل مع الإصدار القادم للاستضافة الذاتية وإلى Nibleaf Cloud تدريجيًا.',
  },
  released: {
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
  return NOTES[AVAILABILITY[capability]][lang];
}

/**
 * One sentence for several capabilities named together, using the least advanced
 * state among them; `undefined` once all of them are live.
 */
export function groupAvailabilityNote(names: string, capabilities: RolloutCapability[], lang: MarketingLang): string | undefined {
  const order: Availability[] = ['in-source', 'released', 'live'];
  const state = order.find((candidate) => capabilities.some((capability) => AVAILABILITY[capability] === candidate)) ?? 'live';
  return state === 'live' ? undefined : `${names}: ${NOTES[state][lang]}`;
}

/** True while a capability is not yet live everywhere, so pages can keep it out of Cloud-only lists. */
export function isRollingOut(capability: RolloutCapability): boolean {
  return AVAILABILITY[capability] !== 'live';
}

const HERO_NOTES: Record<MarketingLang, string> = {
  en: 'Ask AI, search insights and AI-assistant connections are new: they are in the open-source code now, arriving in the next self-hosted release and on Nibleaf Cloud as they roll out.',
  ar: 'ميزات «اسأل المساعد» ورؤى البحث وربط مساعدي الذكاء الاصطناعي جديدة: موجودة الآن في الشيفرة المفتوحة المصدر، وتصل مع الإصدار القادم للاستضافة الذاتية وإلى Nibleaf Cloud تدريجيًا.',
};

/** One-line caption for the hero while any AI capability is still rolling out; `undefined` once all are live. */
export function heroAvailabilityNote(lang: MarketingLang): string | undefined {
  const rolling = (['askAi', 'docsInsights', 'supportMcp'] as const).some((capability) => isRollingOut(capability));
  return rolling ? HERO_NOTES[lang] : undefined;
}
