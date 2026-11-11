/**
 * Site settings → Languages, as pure logic: the order rows appear in, who may
 * change them, which row actions are allowed and why not, and what the
 * coverage line says. Rendered by `components/languages-settings.tsx`; tested
 * in `languages.test.ts`.
 *
 * The rules mirror the server (apps/server/src/actions/languages.ts and the
 * languages routes): Editors and above manage languages; the default language
 * can't be hidden or deleted; promoting a hidden language to default shows it
 * again, so a hidden language may still be made default.
 */
import type { SiteEditState } from '@/lib/project-settings-access';

export { orderLanguages } from '@/features/site-general/model/general';

type LanguageLike = { id: string; isDefault: boolean; enabled?: boolean; direction: 'LTR' | 'RTL' };

/** Rows fetched before the serving flag existed have no `enabled`: they serve. */
export const isShownOnSite = (language: Pick<LanguageLike, 'enabled'>) => language.enabled !== false;

/** The `dir` for a language's own name, independent of the interface locale. */
export const languageDir = (language: Pick<LanguageLike, 'direction'>): 'rtl' | 'ltr' => (language.direction === 'RTL' ? 'rtl' : 'ltr');

/**
 * What this person can do on the Languages screen, from their edit access
 * (managing languages needs Editor or above, like the server's guard):
 * - `manage`: every allowed action is offered;
 * - `readOnly`: a Viewer. Write controls are hidden and the screen says why once;
 * - `locked`: access is still loading. Controls show but are locked, with no reason;
 * - `unknown`: the team failed to load. Locked like `locked`, plus a retry.
 */
export type LanguagesAccess = 'manage' | 'readOnly' | 'locked' | 'unknown';

export function languagesAccess(edit: SiteEditState): LanguagesAccess {
  switch (edit) {
    case 'edit':
      return 'manage';
    case 'viewOnly':
      return 'readOnly';
    case 'unknown':
      return 'unknown';
    default:
      return 'locked';
  }
}

/** Whether write controls render at all. Viewers never see them; unknown access shows them locked. */
export const showsWriteControls = (access: LanguagesAccess) => access !== 'readOnly';

/** Why an action isn't available. The component turns each into copy. */
export type LanguageActionReason = 'alreadyDefault' | 'defaultAlwaysShown' | 'defaultCantBeDeleted' | 'saving';

/**
 * One action's state: `allowed`, `locked` (access unknown, so no reason is
 * given), or `disabled` with a reason.
 */
export type Decision = { state: 'allowed' } | { state: 'locked' } | { state: 'disabled'; reason: LanguageActionReason };

const allowed: Decision = { state: 'allowed' };
const locked: Decision = { state: 'locked' };
const disabled = (reason: LanguageActionReason): Decision => ({ state: 'disabled', reason });

/** Writes still in flight, by language id. */
export type PendingLanguageWrites = {
  /** The language being made default, while that request runs. */
  defaultTo: string | null;
  /** Languages whose show/hide request is running. */
  visibility: readonly string[];
  /** Languages being deleted. */
  removing: readonly string[];
};

export const NO_PENDING_WRITES: PendingLanguageWrites = { defaultTo: null, visibility: [], removing: [] };

export type LanguageRowActions = {
  makeDefault: Decision;
  /** Show or hide on the published site; `next` is what choosing it does. */
  visibility: Decision & { next: 'show' | 'hide' };
  remove: Decision;
};

/**
 * Which actions a row offers and why any is unavailable.
 *
 * "One default language" is an invariant the server maintains by changing
 * other rows, so while a default change runs, every Make default is locked
 * with "Saving…", and so are the actions on the two rows it touches
 * (operations/ui-overhaul.md §8.2).
 */
export function languageRowActions(
  language: LanguageLike,
  access: LanguagesAccess,
  pending: PendingLanguageWrites = NO_PENDING_WRITES,
): LanguageRowActions {
  const next = isShownOnSite(language) ? 'hide' : 'show';
  if (access !== 'manage') return { makeDefault: locked, visibility: { ...locked, next }, remove: locked };

  const defaultChanging = pending.defaultTo !== null;
  const touchedByDefaultChange = defaultChanging && (language.isDefault || pending.defaultTo === language.id);
  const busy = touchedByDefaultChange || pending.removing.includes(language.id);

  const makeDefault = language.isDefault ? disabled('alreadyDefault') : defaultChanging || busy ? disabled('saving') : allowed;
  const visibility = language.isDefault
    ? disabled('defaultAlwaysShown')
    : busy || pending.visibility.includes(language.id)
      ? disabled('saving')
      : allowed;
  const remove = language.isDefault ? disabled('defaultCantBeDeleted') : busy ? disabled('saving') : allowed;
  return { makeDefault, visibility: { ...visibility, next }, remove };
}

/** The Add language entry point: hidden for Viewers, locked while access is unknown. */
export function addLanguageDecision(access: LanguagesAccess): Decision {
  return access === 'manage' ? allowed : locked;
}

type CoverageLike = {
  pageCount: number;
  sourcePageCount: number;
  matchedPages: number;
  missingPages: number;
  extraPages: number;
  percentage: number | null;
};

export type CoverageSummary =
  /** The default language is the source: how many pages it has. */
  | { kind: 'source'; pageCount: number; missing: number; extra: number }
  /** The default language has no pages to compare against. */
  | { kind: 'noSource'; missing: number; extra: number }
  | {
      kind: 'compared';
      matched: number;
      total: number;
      percentage: number | null;
      /** How the coverage badge reads: complete, partial, or nothing translated yet. */
      tone: 'complete' | 'partial' | 'none';
      missing: number;
      extra: number;
    };

/** What a row's coverage line and badge say, or null when the server sent no coverage. */
export function coverageSummary(language: { isDefault: boolean; coverage?: CoverageLike | null }): CoverageSummary | null {
  const coverage = language.coverage;
  if (!coverage) return null;
  const missing = coverage.missingPages;
  const extra = coverage.extraPages;
  if (language.isDefault) return { kind: 'source', pageCount: coverage.pageCount, missing, extra };
  if (coverage.sourcePageCount === 0) return { kind: 'noSource', missing, extra };
  const percentage = coverage.percentage;
  const tone = percentage === null ? 'partial' : percentage >= 100 ? 'complete' : percentage <= 0 ? 'none' : 'partial';
  return { kind: 'compared', matched: coverage.matchedPages, total: coverage.sourcePageCount, percentage, tone, missing, extra };
}
