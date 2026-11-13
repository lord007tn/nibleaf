/**
 * What the site's next publish would change, in the words the dashboard shows
 * outside the editor (P1-DASH-005): the top bar's Publish count, Overview's
 * activity line, the Publishes page's draft row, and Recent pages' status.
 * Pure logic; tested in `pending.test.ts`.
 */
import { pageNeverPublished, pagePublishState } from '@/hooks/api/deployment-cache';

interface PendingLike {
  hasBaseline: boolean;
  lastVersion: number | null;
  upToDate?: boolean;
  changes: ReadonlyArray<{ id: string; status: string }>;
}

export type PendingState =
  /** The check hasn't answered (or failed): say nothing rather than guess. */
  | { kind: 'unknown' }
  /** Nothing published yet: the first-publish flow owns this case. */
  | { kind: 'neverPublished' }
  | { kind: 'upToDate'; liveVersion: number | null }
  /** Pages changed since the live version. */
  | { kind: 'changes'; count: number; liveVersion: number | null }
  /** Only navigation groups or site settings changed: no page is listed, but the live site is behind. */
  | { kind: 'siteOnly'; liveVersion: number | null };

export function pendingState(pending: PendingLike | undefined): PendingState {
  if (!pending) return { kind: 'unknown' };
  if (!pending.hasBaseline) return { kind: 'neverPublished' };
  const liveVersion = pending.lastVersion;
  if (pending.changes.length > 0) return { kind: 'changes', count: pending.changes.length, liveVersion };
  return pending.upToDate === false ? { kind: 'siteOnly', liveVersion } : { kind: 'upToDate', liveVersion };
}

/** Whether the live site is behind the drafts. */
export const hasUnpublishedChanges = (state: PendingState): state is Extract<PendingState, { kind: 'changes' | 'siteOnly' }> =>
  state.kind === 'changes' || state.kind === 'siteOnly';

export type PageLiveStatus = 'draft' | 'changed' | 'live';

/** A page's status against the live site: never published, changed since, or live as drafted. Unknown: undefined. */
export function pageLiveStatus(pageId: string, pending: PendingLike | undefined): PageLiveStatus | undefined {
  if (!pending) return undefined;
  if (pageNeverPublished(pageId, pending)) return 'draft';
  return pagePublishState(pageId, pending) === 'unpublished' ? 'changed' : 'live';
}
