import type { MessageKey, MessageVariables } from '@nibleaf/i18n';
import type { BranchMergePreview } from '@/hooks/api';

export type PromoteChange = BranchMergePreview['changedOnMainSinceFork'][number];

/** What promoting does to a page on main, worst first: refused, loses main's
 *  edits, moves or comes back, or stays as main has it. */
export type PromoteGroup = 'blocked' | 'lost' | 'moves' | 'stays';

const GROUP_ORDER: readonly PromoteGroup[] = ['blocked', 'lost', 'moves', 'stays'];

const promoteGroupOf = (entry: PromoteChange): PromoteGroup => {
  switch (entry.onPromote) {
    case 'blocked':
      return 'blocked';
    case 'replaced':
      return 'lost';
    // Deleted on main and dropped from the version: main keeps its deletion.
    case 'removed':
      return entry.change === 'deleted' ? 'stays' : 'lost';
    case 'renamed':
    case 'moved':
    case 'restored':
      return 'moves';
    default:
      return 'stays';
  }
};

/** The preview's pages in their groups, in display order; empty groups are left out. */
export const groupPromoteChanges = (entries: readonly PromoteChange[]) =>
  GROUP_ORDER.map((group) => ({ group, entries: entries.filter((entry) => promoteGroupOf(entry) === group) })).filter(
    (section) => section.entries.length > 0,
  );

/** Promote may confirm on its own only when every page stays exactly as main has it. */
export const promoteNeedsReview = (preview: BranchMergePreview): boolean =>
  preview.changedOnMainSinceFork.some((entry) => entry.onPromote !== 'kept');

export const promoteIsBlocked = (preview: BranchMergePreview): boolean =>
  preview.changedOnMainSinceFork.some((entry) => entry.onPromote === 'blocked');

/** A 409's `details` is a preview to review again when it carries a list and a fingerprint. */
export const asPromotePreview = (details: unknown): BranchMergePreview | null => {
  const candidate = details as Partial<BranchMergePreview> | undefined;
  return candidate && Array.isArray(candidate.changedOnMainSinceFork) && typeof candidate.fingerprint === 'string'
    ? {
        baselineComplete: candidate.baselineComplete !== false,
        changedOnMainSinceFork: candidate.changedOnMainSinceFork,
        fingerprint: candidate.fingerprint,
      }
    : null;
};

// A Map, so a field name never resolves through Object.prototype.
const FIELD_LABELS = new Map<string, MessageKey>([
  ['title', 'editor.pageSettings.pageTitle'],
  ['slug', 'editor.pageSettings.slug'],
  ['icon', 'editor.pageSettings.icon'],
  ['description', 'editor.pageSettings.description'],
  ['hidden', 'editor.pageSettings.hidden'],
  ['translationKey', 'editor.pageSettings.translationKey'],
  ['kind', 'editor.promote.field.kind'],
  ['content', 'editor.mode.content'],
  ['settings', 'editor.pageSettings.title'],
  ['parent', 'editor.promote.field.parent'],
]);

type Translate = (key: MessageKey, variables?: MessageVariables) => string;

/** One plain sentence on what promoting does to this page. */
export const promoteOutcome = (t: Translate, entry: PromoteChange, locale?: string): string => {
  switch (entry.onPromote) {
    case 'replaced': {
      const labels = (entry.replacedFields ?? []).map((field) => {
        const key = FIELD_LABELS.get(field);
        return key ? t(key) : field;
      });
      const fields = new Intl.ListFormat(locale, { type: 'conjunction' }).format(labels);
      return t('editor.promote.replaced', { fields });
    }
    case 'removed':
      return t(entry.change === 'deleted' ? 'editor.promote.stayDeleted' : 'editor.promote.removed');
    case 'renamed':
      return t('editor.promote.renamed', { path: entry.newPath ?? entry.path });
    case 'moved':
      return entry.newParentPath ? t('editor.promote.moved', { path: entry.newParentPath }) : t('editor.promote.movedTop');
    case 'restored':
      return t('editor.promote.restored');
    case 'merged':
      return t('editor.promote.merged');
    case 'blocked':
      return t('editor.promote.blocked');
    default:
      return t('editor.promote.kept');
  }
};
