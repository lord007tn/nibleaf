/**
 * Site settings → Search, as pure logic: what the form edits, how it is
 * validated, which requests a save sends, who may change what, and how the
 * index health reads. Rendered by `components/search-settings.tsx`; tested in
 * `search.test.ts`.
 */
import type { MessageKey } from '@nibleaf/i18n';
import { aiStarterQuestionsSchema, aiSupportUrlSchema, SEARCH_MAX_RESULTS } from '@nibleaf/validators';
import type { SiteAdminState } from '@/lib/project-settings-access';

export type SearchHotkey = 'cmdk' | 'slash';

export const SEARCH_HOTKEYS: readonly SearchHotkey[] = ['cmdk', 'slash'];

/** The keys as readers press them; shortcuts are the same in every language. */
export const HOTKEY_LABEL: Record<SearchHotkey, string> = { cmdk: '⌘K', slash: '/' };

/**
 * Results per query when the server sends no range of its own: the shared
 * defaults (default 12, from 1 to 50). The server's `constraints.maxResults`
 * is the source of truth whenever the configuration has loaded.
 */
export const DEFAULT_MAX_RESULTS_RANGE: MaxResultsRange = SEARCH_MAX_RESULTS;

/** The longest placeholder the server stores (site-wide and per language). */
export const SEARCH_PLACEHOLDER_MAX = 80;

export type MaxResultsRange = { default: number; min: number; max: number };

/**
 * The site's search configuration as the server resolves it: a structural
 * copy of `searchConfigurationResultSchema['configuration']`, so the model
 * takes plain values.
 */
export type SearchConfigurationLike = {
  maxResults: number;
  versionFilterEnabled: boolean;
  aiAnswers: boolean;
  aiConversationCapture: boolean;
  aiStarterQuestions: readonly string[];
  aiSupportUrl?: string | null;
  hotkey: SearchHotkey;
  placeholder: string | null;
};

type LanguageLike = {
  id: string;
  isDefault: boolean;
  position: number;
  config?: { search?: { placeholder?: string | null } | null } | null;
};

/** Everything the Search form edits, in one place, so "dirty" has one meaning. */
export type SearchValues = {
  placeholder: string;
  /** As typed, so an out-of-range number can be shown and explained. */
  maxResults: string;
  hotkey: SearchHotkey;
  versionFilterEnabled: boolean;
  aiAnswers: boolean;
  aiConversationCapture: boolean;
  /** One question per line. */
  aiStarterQuestions: string;
  aiSupportUrl: string;
  /** The placeholder per non-default language, by language id. Empty uses the site's. */
  languagePlaceholders: Record<string, string>;
};

/** The default language first, then by position: the order every language list uses. */
export function orderLanguages<T extends { isDefault: boolean; position: number }>(languages: readonly T[]): T[] {
  return [...languages].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.position - b.position);
}

/** The form's values for a site, normalized the way the server stores them. */
export function searchValues(configuration: SearchConfigurationLike, languages: readonly LanguageLike[] = []): SearchValues {
  const languagePlaceholders: Record<string, string> = {};
  for (const language of orderLanguages(languages)) {
    if (!language.isDefault) languagePlaceholders[language.id] = language.config?.search?.placeholder ?? '';
  }
  return {
    placeholder: configuration.placeholder ?? '',
    maxResults: String(configuration.maxResults),
    hotkey: configuration.hotkey,
    versionFilterEnabled: configuration.versionFilterEnabled,
    aiAnswers: configuration.aiAnswers,
    aiConversationCapture: configuration.aiConversationCapture,
    aiStarterQuestions: configuration.aiStarterQuestions.join('\n'),
    aiSupportUrl: configuration.aiSupportUrl ?? '',
    languagePlaceholders,
  };
}

/** The suggested questions a block of text holds: one per non-empty line, trimmed. */
export const starterQuestions = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

/** What a save sends: text trimmed and blank lines dropped, as the server would store it. */
export function normalizeSearch(values: SearchValues): SearchValues {
  const languagePlaceholders: Record<string, string> = {};
  for (const [id, placeholder] of Object.entries(values.languagePlaceholders)) languagePlaceholders[id] = placeholder.trim();
  return {
    ...values,
    placeholder: values.placeholder.trim(),
    maxResults: values.maxResults.trim(),
    aiStarterQuestions: starterQuestions(values.aiStarterQuestions).join('\n'),
    aiSupportUrl: values.aiSupportUrl.trim(),
    languagePlaceholders,
  };
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * What is wrong with the results-per-query field. It is never clamped behind
 * the person's back: a number outside the range is an error they can see.
 */
export function maxResultsProblem(value: string, range: Pick<MaxResultsRange, 'min' | 'max'> = DEFAULT_MAX_RESULTS_RANGE): 'range' | undefined {
  const text = value.trim();
  if (!/^\d+$/.test(text)) return 'range';
  const number = Number(text);
  return number >= range.min && number <= range.max ? undefined : 'range';
}

/** Up to four questions of 3-120 characters each (the server's rule). */
export const startersProblem = (text: string): 'invalid' | undefined =>
  aiStarterQuestionsSchema.safeParse(starterQuestions(text)).success ? undefined : 'invalid';

/** An https:// link or a mailto: address; empty hides the link. */
export const supportUrlProblem = (text: string): 'invalid' | undefined =>
  !text.trim() || aiSupportUrlSchema.safeParse(text).success ? undefined : 'invalid';

// ─── Saving ─────────────────────────────────────────────────────────────────

/** The fields a configuration update sends: a structural copy of `UpdateProjectSearchConfigurationBody`. */
export type SearchConfigurationPatch = {
  placeholder?: string | null;
  maxResults?: number;
  hotkey?: SearchHotkey;
  versionFilterEnabled?: boolean;
  aiAnswers?: boolean;
  aiConversationCapture?: boolean;
  aiStarterQuestions?: string[];
  aiSupportUrl?: string | null;
};

/** One language's placeholder override; `null` clears it, so the language uses the site's placeholder. */
export type LanguagePlaceholderUpdate = { id: string; placeholder: string | null };

/**
 * The requests a save sends for the change from `baseline` to `submitted`:
 * one configuration update with only the fields that changed (so it never
 * overwrites a setting someone else changed meanwhile), and one language
 * update per placeholder that changed. Assumes `submitted` is valid.
 */
export function searchSaveRequests(
  baseline: SearchValues,
  submitted: SearchValues,
): { configuration: SearchConfigurationPatch | null; languages: LanguagePlaceholderUpdate[] } {
  const before = normalizeSearch(baseline);
  const after = normalizeSearch(submitted);
  const patch: SearchConfigurationPatch = {};
  if (before.placeholder !== after.placeholder) patch.placeholder = after.placeholder || null;
  if (before.maxResults !== after.maxResults) patch.maxResults = Number(after.maxResults);
  if (before.hotkey !== after.hotkey) patch.hotkey = after.hotkey;
  if (before.versionFilterEnabled !== after.versionFilterEnabled) patch.versionFilterEnabled = after.versionFilterEnabled;
  if (before.aiAnswers !== after.aiAnswers) patch.aiAnswers = after.aiAnswers;
  if (before.aiConversationCapture !== after.aiConversationCapture) patch.aiConversationCapture = after.aiConversationCapture;
  if (before.aiStarterQuestions !== after.aiStarterQuestions) patch.aiStarterQuestions = starterQuestions(after.aiStarterQuestions);
  if (before.aiSupportUrl !== after.aiSupportUrl) patch.aiSupportUrl = after.aiSupportUrl || null;

  const languages: LanguagePlaceholderUpdate[] = [];
  for (const [id, placeholder] of Object.entries(after.languagePlaceholders)) {
    if ((before.languagePlaceholders[id] ?? '') === placeholder) continue;
    languages.push({ id, placeholder: placeholder || null });
  }
  return { configuration: Object.keys(patch).length > 0 ? patch : null, languages };
}

// ─── Access ─────────────────────────────────────────────────────────────────

/**
 * What a control may do:
 * - `allowed`: usable;
 * - `locked`: disabled with nothing to say (access still loading, or the page
 *   is read-only and says why once at the top);
 * - `denied`: disabled, with the reason shown next to it.
 */
export type Decision = { kind: 'allowed' } | { kind: 'locked' } | { kind: 'denied'; reason: MessageKey };

const allowed: Decision = { kind: 'allowed' };
const locked: Decision = { kind: 'locked' };
const denied = (reason: MessageKey): Decision => ({ kind: 'denied', reason });

/** Someone who isn't a site Admin sees Search read-only, with one note at the top. Null otherwise. */
export const readOnlyNote = (status: SiteAdminState): MessageKey | null => (status === 'notAdmin' ? 'settings.permissions.body' : null);

/** The form's fields: Admins only; locked while access is unknown. */
export const fieldsDecision = (status: SiteAdminState): Decision => (status === 'admin' ? allowed : locked);

/** `groundedAnswersState` (lib/grounded-answers.ts): whether the site can serve grounded answers. */
export type GroundedAnswersState = 'available' | 'needsConnection' | 'needsServer' | 'pending';

const GROUNDED_ANSWERS_MISSING: Partial<Record<GroundedAnswersState, MessageKey>> = {
  needsConnection: 'settings.search.aiAnswers.needsConnection',
  needsServer: 'settings.search.aiAnswers.needsServer',
};

/**
 * The grounded-answers switch. It can be turned on only when the site has a
 * working AI connection; when it is already on it can always be turned off.
 * `note` says what is missing when the switch stays usable anyway (on, but
 * not served); a denied switch carries the same words as its reason.
 * `linkToSmartAi`: the fix is in this site's Smart AI settings.
 */
export function aiAnswersControl(
  state: GroundedAnswersState,
  savedOn: boolean,
  status: SiteAdminState,
): { decision: Decision; note: MessageKey | null; linkToSmartAi: boolean } {
  const missing = GROUNDED_ANSWERS_MISSING[state] ?? null;
  const linkToSmartAi = state === 'needsConnection' && status === 'admin';
  if (status !== 'admin') return { decision: locked, note: null, linkToSmartAi: false };
  if (state === 'available' || savedOn) return { decision: allowed, note: missing, linkToSmartAi };
  if (missing) return { decision: denied(missing), note: null, linkToSmartAi };
  return { decision: locked, note: null, linkToSmartAi: false };
}

/** A decision as the props a control takes: disabled, with the reason when there is one. */
export function decisionProps(decision: Decision): { disabled: boolean; reason?: MessageKey } {
  if (decision.kind === 'allowed') return { disabled: false };
  if (decision.kind === 'locked') return { disabled: true };
  return { disabled: true, reason: decision.reason };
}

// ─── Index health ───────────────────────────────────────────────────────────

export type IndexHealth = 'ready' | 'indexing' | 'stale' | 'failed' | 'empty' | 'unavailable';
export type IndexUnavailableReason = 'not_configured' | 'not_published' | 'provider_unavailable';

/** The parts of the index diagnostics these rules read (structural, like `SearchIndexDiagnosticsResult`). */
export type IndexDiagnosticsLike = {
  availability: { reason: IndexUnavailableReason | null };
  health: IndexHealth;
};

/** The DS `StatusBadge` tones this section uses. */
export type HealthTone = 'success' | 'pending' | 'warning' | 'danger' | 'neutral';

export const HEALTH: Record<IndexHealth, { label: MessageKey; tone: HealthTone }> = {
  ready: { label: 'settings.search.diagnostics.health.ready', tone: 'success' },
  indexing: { label: 'settings.search.diagnostics.health.indexing', tone: 'pending' },
  stale: { label: 'settings.search.diagnostics.health.stale', tone: 'warning' },
  failed: { label: 'settings.search.diagnostics.health.failed', tone: 'danger' },
  empty: { label: 'settings.search.diagnostics.health.empty', tone: 'neutral' },
  unavailable: { label: 'settings.search.diagnostics.health.unavailable', tone: 'neutral' },
};

/** Why the index can't be inspected, in the owner's words. */
export const UNAVAILABLE_REASON: Record<IndexUnavailableReason, MessageKey> = {
  not_configured: 'settings.search.diagnostics.notConfigured',
  not_published: 'settings.search.diagnostics.notPublished',
  provider_unavailable: 'settings.search.diagnostics.providerUnavailable',
};

/**
 * Reindex: Admins only, once the index state is known. It is refused, with the
 * reason, when indexing isn't set up on this server, when there is no
 * published revision to index, and while a run is already going. A provider
 * that is down for now doesn't block it: queuing is how the owner recovers.
 */
export function reindexDecision(data: IndexDiagnosticsLike | undefined, status: SiteAdminState): Decision {
  if (status !== 'admin' || !data) return locked;
  const { reason } = data.availability;
  if (reason === 'not_configured' || reason === 'not_published') return denied(UNAVAILABLE_REASON[reason]);
  if (data.health === 'indexing') return denied('settings.search.diagnostics.reindexActive');
  return allowed;
}

/** Whether the index recorded stale or failed chunks worth a warning. */
export const hasIndexIssues = (issues: { staleCount: number; failedCount: number }) => issues.staleCount > 0 || issues.failedCount > 0;

/** An issue sample's badge: its stable error code when it has one, else failed or stale. */
export function issueBadge(item: { status: 'stale' | 'failed'; errorCode?: string }): {
  label: MessageKey;
  code?: string;
  tone: 'danger' | 'warning';
} {
  const tone = item.status === 'failed' ? 'danger' : 'warning';
  if (item.errorCode) return { label: 'settings.search.diagnostics.issueCode', code: item.errorCode, tone };
  return { label: item.status === 'failed' ? 'settings.search.diagnostics.issueFailed' : 'settings.search.diagnostics.issueStale', tone };
}

/** "en · 120, ar · 80", or null when there is nothing to list. */
export const distributionText = (items: ReadonlyArray<{ key: string; count: number }>): string | null =>
  items.length > 0 ? items.map((item) => `${item.key} · ${item.count}`).join(', ') : null;

/** Where the sample pager can go: back once it has moved forward, forward while the server has more. */
export const samplePager = (depth: number, nextCursor: string | null | undefined) => ({
  canGoBack: depth > 1,
  canGoForward: Boolean(nextCursor),
});
