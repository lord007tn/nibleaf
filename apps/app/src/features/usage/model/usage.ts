import type { MessageKey } from '@nibleaf/i18n';
import type { LimitState, UsageAvailability } from '@nibleaf/usage';

/**
 * Usage meters, as the website's Usage page and the organization's Usage &
 * billing page show them (operations/ui-overhaul.md §3, WORKSPACE-19). Pure:
 * which meters go where, what each state is called and how it looks, and the
 * share of a limit, with no React or data layer.
 */

/** The meter's icon, by name; components map names to icons. */
export type MeterIcon =
  | 'users'
  | 'hardDrive'
  | 'globe'
  | 'files'
  | 'eye'
  | 'search'
  | 'bot'
  | 'arrowDown'
  | 'arrowUp'
  | 'boxes'
  | 'database'
  | 'rocket';

const METERS: Readonly<Record<string, { icon: MeterIcon; label: MessageKey }>> = {
  editor_seat: { icon: 'users', label: 'settings.usage.meter.editorSeat' },
  asset_storage_byte: { icon: 'hardDrive', label: 'settings.usage.meter.assetStorage' },
  custom_domain: { icon: 'globe', label: 'settings.usage.meter.customDomain' },
  published_page: { icon: 'files', label: 'settings.usage.meter.publishedPage' },
  public_page_view: { icon: 'eye', label: 'settings.usage.meter.publicPageView' },
  search_query: { icon: 'search', label: 'settings.usage.meter.searchQuery' },
  ai_answer: { icon: 'bot', label: 'settings.usage.meter.aiAnswer' },
  ai_input_token: { icon: 'arrowDown', label: 'settings.usage.meter.aiInputToken' },
  ai_output_token: { icon: 'arrowUp', label: 'settings.usage.meter.aiOutputToken' },
  embedded_chunk: { icon: 'boxes', label: 'settings.usage.meter.embeddedChunk' },
  indexed_content_byte: { icon: 'database', label: 'settings.usage.meter.indexedContent' },
  build: { icon: 'rocket', label: 'settings.usage.meter.build' },
};

/** A meter's name and icon; an unknown key still renders, with a generic name. */
export const meterPresentation = (key: string) =>
  Object.hasOwn(METERS, key)
    ? (METERS[key] as { icon: MeterIcon; label: MessageKey })
    : { icon: 'database' as const, label: 'settings.usage.meter.unknown' as const };

/** The groups, in order, each with its meters in order. */
export const USAGE_GROUPS = [
  {
    title: 'settings.usage.group.capacity',
    description: 'settings.usage.group.capacity.description',
    keys: ['published_page', 'editor_seat', 'asset_storage_byte', 'custom_domain'],
  },
  {
    title: 'settings.usage.group.delivery',
    description: 'settings.usage.group.delivery.description',
    keys: ['build', 'public_page_view'],
  },
  {
    title: 'settings.usage.group.searchAi',
    description: 'settings.usage.group.searchAi.description',
    keys: ['search_query', 'ai_answer', 'ai_input_token', 'ai_output_token', 'embedded_chunk', 'indexed_content_byte'],
  },
] as const satisfies ReadonlyArray<{ title: MessageKey; description: MessageKey; keys: readonly string[] }>;

/** Seats are an organization figure, counted once per organization (§10.3), so a website doesn't show them. */
export const WEBSITE_HIDDEN_METERS: ReadonlySet<string> = new Set(['editor_seat']);

export const AVAILABILITY_TEXT: Record<UsageAvailability, MessageKey> = {
  complete: 'settings.usage.availability.complete',
  partial: 'settings.usage.availability.partial',
  unavailable: 'settings.usage.availability.unavailable',
};

const STATE_TEXT: Record<LimitState, MessageKey> = {
  available: 'settings.usage.state.available',
  approaching: 'settings.usage.state.approaching',
  exceeded: 'settings.usage.state.exceeded',
  unknown: 'settings.usage.state.unknown',
  unlimited: 'settings.usage.state.unlimited',
};

/** The DS `StatusBadge` tones a meter uses. */
type MeterTone = 'success' | 'warning' | 'danger' | 'neutral';

const UNAVAILABLE_REASON_TEXT = {
  metering_disabled: 'settings.usage.reason.meteringDisabled',
  query_failed: 'settings.usage.reason.queryFailed',
  delayed: 'settings.usage.reason.delayed',
  catching_up: 'settings.usage.reason.catchingUp',
  tokens_incomplete: 'settings.usage.reason.tokensIncomplete',
  not_measured: 'settings.usage.reason.notMeasured',
  seats_unavailable: 'settings.usage.reason.seatsUnavailable',
} as const satisfies Record<string, MessageKey>;

/** Why a number is missing, named instead of a bare "Unknown"; the generic line only for an unknown cause. */
export const unavailableExplanationKey = (reason: string | null | undefined): MessageKey =>
  reason && Object.hasOwn(UNAVAILABLE_REASON_TEXT, reason)
    ? UNAVAILABLE_REASON_TEXT[reason as keyof typeof UNAVAILABLE_REASON_TEXT]
    : 'settings.usage.unknownExplanation';

export type MeterLike = {
  key: string;
  quantity: string | null;
  ratio: number | null;
  state: LimitState;
  availability?: UsageAvailability;
  unavailableReason?: string | null;
  limit?: unknown;
};

export type MeterView = {
  /** The badge: what the state is called and how it looks. Only approaching and exceeded may look like a warning. */
  badge: { label: MessageKey; tone: MeterTone };
  /** The limit, when there is one. */
  limit: string | null;
  /** The real share of the limit in percent, which can pass 100; null when there is no share to announce (a zero limit). */
  share: number | null;
  /** The bar: its width (a 2% sliver keeps a tiny amount visible; drawing only) and its value for assistive tech. */
  bar: { width: number; value: number; tone: 'primary' | 'warning' | 'danger' } | null;
  /** Why the number is missing, when it is. */
  missing: MessageKey | null;
};

/** How one meter reads: its badge, its share of the limit and its bar, or why its number is missing. */
export function meterView(meter: MeterLike): MeterView {
  const partial = meter.availability === 'partial';
  const stateTone: MeterTone =
    meter.state === 'exceeded' ? 'danger' : meter.state === 'approaching' ? 'warning' : meter.state === 'available' ? 'success' : 'neutral';
  const badge: MeterView['badge'] = partial
    ? { label: 'settings.usage.state.partial', tone: 'neutral' }
    : { label: STATE_TEXT[meter.state], tone: stateTone };
  const limit = typeof meter.limit === 'string' ? meter.limit : null;
  const missing = meter.quantity === null ? unavailableExplanationKey(meter.unavailableReason) : null;
  // No ratio with a limit means a zero limit: no share to announce, only
  // whether it is exceeded (any use of a 0 limit is). Never invent "0%".
  const share = meter.ratio === null ? null : meter.ratio * 100;
  const percent = share ?? (meter.state === 'exceeded' ? 100 : 0);
  const bar =
    limit && !missing
      ? {
          width: Math.min(100, Math.max(percent > 0 ? 2 : 0, percent)),
          value: Math.min(100, Math.round(percent)),
          tone: meter.state === 'exceeded' ? ('danger' as const) : meter.state === 'approaching' ? ('warning' as const) : ('primary' as const),
        }
      : null;
  return { badge, limit, share, bar, missing };
}

/**
 * When every missing number has the same reason (metering not turned on, say),
 * the page says it once instead of on each tile. Null when the reasons differ
 * or fewer than two numbers are missing.
 */
export function sharedMissingReason(meters: ReadonlyArray<Pick<MeterLike, 'quantity' | 'unavailableReason'>>): MessageKey | null {
  const reasons = meters.filter((meter) => meter.quantity === null).map((meter) => unavailableExplanationKey(meter.unavailableReason));
  if (reasons.length < 2) return null;
  return reasons.every((reason) => reason === reasons[0]) ? (reasons[0] ?? null) : null;
}
