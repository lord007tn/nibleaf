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
 * `released`: in a published self-hosted release, still rolling out to Cloud.
 * `live`: in a published self-hosted release and enabled on nibleaf.com.
 * `selfHostedSince` is the first published self-hosted release that contains the
 * capability (`null` while it is only on main). Move a capability forward only
 * when that is true; every page that mentions it picks the change up.
 * `availability.test.ts` checks both against `release/self-host.json`, and keeps
 * rollout wording out of the rest of the marketing copy.
 */
type Availability = 'in-source' | 'released' | 'live';

/** A published self-hosted release tag, as in `release/self-host.json`. */
type SelfHostedRelease = `v${number}.${number}.${number}`;

interface CapabilityAvailability {
  availability: Availability;
  selfHostedSince: SelfHostedRelease | null;
}

export type RolloutCapability =
  | 'askAi'
  | 'readerSearch'
  | 'supportMcp'
  | 'docsInsights'
  | 'bringYourOwnKey'
  | 'readerThemes'
  | 'gitbookImport'
  | 'readerAnalytics'
  | 'dashboardOnboarding';

/** Every capability shipped in self-hosted v0.2.1 and is live on Nibleaf Cloud. */
export const CAPABILITY_AVAILABILITY: Record<RolloutCapability, CapabilityAvailability> = {
  /** Ask AI reader chat (#279). */
  askAi: { availability: 'live', selfHostedSince: 'v0.2.1' },
  /** The redesigned reader search (#281): section-level results, recent searches, the Ask AI hand-off. */
  readerSearch: { availability: 'live', selfHostedSince: 'v0.2.1' },
  /** Support MCP writes, presets and OAuth (#280). */
  supportMcp: { availability: 'live', selfHostedSince: 'v0.2.1' },
  docsInsights: { availability: 'live', selfHostedSince: 'v0.2.1' },
  bringYourOwnKey: { availability: 'live', selfHostedSince: 'v0.2.1' },
  /** Harbor, Manuscript and Signal (#96, #101, #104): merged after the v0.1.2 release. */
  readerThemes: { availability: 'live', selfHostedSince: 'v0.2.1' },
  /** The GitBook Git Sync importer (#235). */
  gitbookImport: { availability: 'live', selfHostedSince: 'v0.2.1' },
  /** The ClickHouse reader-analytics pipeline (#97): consent linking, no IP storage, the two-visit search-term threshold. */
  readerAnalytics: { availability: 'live', selfHostedSince: 'v0.2.1' },
  /** The start-here checklist and page, setting and action search in the command palette (#283). */
  dashboardOnboarding: { availability: 'live', selfHostedSince: 'v0.2.1' },
};

/** Orders `vX.Y.Z` release tags numerically; negative when `a` is older. */
export function compareReleases(a: string, b: string): number {
  const parts = (tag: string) => tag.replace(/^v/, '').split('.').map(Number);
  const [left, right] = [parts(a), parts(b)];
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const NOTES: Record<Availability, Record<MarketingLang, (since: string) => string>> = {
  'in-source': {
    en: () => 'In the open-source code now; arriving in the next self-hosted release and on Nibleaf Cloud as it rolls out.',
    ar: () => 'موجودة الآن في الشيفرة المفتوحة المصدر، وتصل مع الإصدار القادم للاستضافة الذاتية وإلى Nibleaf Cloud تدريجيًا.',
  },
  released: {
    en: (since) => `Available when you self-host ${since} or later, and on Nibleaf Cloud as it rolls out.`,
    ar: (since) => `متاحة عند الاستضافة الذاتية بالإصدار ${since} أو أحدث، وتصل إلى Nibleaf Cloud تدريجيًا.`,
  },
  live: {
    en: (since) => `Available on Nibleaf Cloud, and when you self-host ${since} or later.`,
    ar: (since) => `متاحة على Nibleaf Cloud، وعند الاستضافة الذاتية بالإصدار ${since} أو أحدث.`,
  },
};

/**
 * Wording that says a capability is not available yet, in English and Arabic.
 * Outside this module it may only reach a page through the notes above, and
 * only while that capability really is below `live` (`availability.test.tsx`).
 */
export const ROLLOUT_WORDING =
  /rolling out|rolls out|roll out|next release|next self-hosted release|coming soon|arriving in the next|الإصدار القادم|الإصدار التالي|قيد الطرح|يُطرح|تصل تدريجيًا|Nibleaf Cloud تدريجيًا/i;

const ORDER: Availability[] = ['in-source', 'released', 'live'];

function note(capabilities: RolloutCapability[], lang: MarketingLang): { state: Availability; text: string } {
  const state =
    ORDER.find((candidate) => capabilities.some((capability) => CAPABILITY_AVAILABILITY[capability].availability === candidate)) ?? 'live';
  const since = capabilities
    .map((capability) => CAPABILITY_AVAILABILITY[capability].selfHostedSince ?? '')
    .reduce((latest, tag) => (compareReleases(tag, latest) > 0 ? tag : latest), '');
  return { state, text: NOTES[state][lang](since) };
}

/** Short, honest availability sentence for one capability in one language. */
export function availabilityNote(capability: RolloutCapability, lang: MarketingLang): string {
  return note([capability], lang).text;
}

/**
 * One sentence for several capabilities named together, using the least advanced
 * state among them; `undefined` once all of them are live.
 */
export function groupAvailabilityNote(names: string, capabilities: RolloutCapability[], lang: MarketingLang): string | undefined {
  const { state, text } = note(capabilities, lang);
  return state === 'live' ? undefined : `${names}: ${text}`;
}

/** True while a capability is not yet live everywhere, so pages can keep it out of Cloud-only lists. */
export function isRollingOut(capability: RolloutCapability): boolean {
  return CAPABILITY_AVAILABILITY[capability].availability !== 'live';
}

const HERO_NAMES: Record<MarketingLang, string> = {
  en: 'Ask AI, search insights and AI-assistant connections',
  ar: '«اسأل المساعد» ورؤى البحث وربط مساعدي الذكاء الاصطناعي',
};

/** One-line caption for the hero while any AI capability is still rolling out; `undefined` once all are live. */
export function heroAvailabilityNote(lang: MarketingLang): string | undefined {
  return groupAvailabilityNote(HERO_NAMES[lang], ['askAi', 'docsInsights', 'supportMcp'], lang);
}
