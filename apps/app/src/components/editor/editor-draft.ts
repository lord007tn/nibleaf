/**
 * Pure decision logic for the page editor's local draft.
 *
 * The editor keeps a local draft (title + content) of ONE page, plus a record of
 * the server copy that draft was hydrated from or last saved as (`synced`).
 * Every decision that can move content between pages or to the server goes
 * through these functions so the invariants are testable in isolation:
 *
 * - switching pages always hydrates the draft from that page's server copy
 *   (including a brand-new empty page — the previous page's body must never
 *   carry over);
 * - a server refresh re-hydrates only while the draft is clean, and only from a
 *   copy that is newer than the one we already have (the detail query is briefly
 *   stale right after a save);
 * - an automatic save only ever runs for the page the draft was hydrated from;
 *   clearing that page is a valid edit, including an entirely empty body.
 */

interface DraftSnapshot {
  title: string;
  content: string;
}

export interface ServerSnapshot extends DraftSnapshot {
  id: string;
  /** Server revision stamp (ISO date); absent for locally-constructed snapshots. */
  updatedAt?: string;
}

export interface DraftState {
  conflicted?: boolean;
  /** Server copy the draft mirrors (hydrated from / last saved as); null before the first load. */
  synced: ServerSnapshot | null;
  draft: DraftSnapshot;
}

/** Build the synced snapshot for a server page. */
export function snapshotOf(page: ServerSnapshot): ServerSnapshot {
  return { id: page.id, title: page.title, content: page.content, ...(page.updatedAt === undefined ? {} : { updatedAt: page.updatedAt }) };
}

/** True when the draft differs from the server copy it was hydrated from. */
export function isDirty({ synced, draft }: DraftState): boolean {
  if (!synced) {
    return false;
  }
  return draft.title !== synced.title || draft.content !== synced.content;
}

/**
 * True when `page` is a strictly newer server revision than `synced`. Without
 * comparable stamps we cannot tell, so the caller falls back to content
 * comparison (returns true).
 */
function isNewerRevision(page: ServerSnapshot, synced: ServerSnapshot): boolean {
  if (page.updatedAt === undefined || synced.updatedAt === undefined) {
    return true;
  }
  const next = Date.parse(page.updatedAt);
  const current = Date.parse(synced.updatedAt);
  if (Number.isNaN(next) || Number.isNaN(current)) {
    return true;
  }
  return next > current;
}

/**
 * Decide whether the local draft must be (re)hydrated from `page`.
 * Returns the snapshot to load, or null to leave the draft alone.
 * `superseded` says whether a revision is one this editor's own stored writes
 * were based on: those writes are newer, whatever its stamp says (#757).
 */
export function nextHydration(
  state: DraftState,
  page: ServerSnapshot | null | undefined,
  superseded?: (revision: string) => boolean,
): ServerSnapshot | null {
  if (!page) {
    return null;
  }
  const { synced } = state;
  if (state.conflicted && synced?.id === page.id) return null;
  // A different page (first load, page switch, a freshly created page, another
  // language): always load its own server copy, whatever the draft holds.
  if (!synced || synced.id !== page.id) {
    return snapshotOf(page);
  }
  // Same page: never clobber unsaved edits.
  if (isDirty(state)) {
    return null;
  }
  const changed = page.title !== synced.title || page.content !== synced.content;
  if (changed && isNewerRevision(page, synced) && !(page.updatedAt !== undefined && superseded?.(page.updatedAt))) {
    return snapshotOf(page);
  }
  return null;
}

/**
 * Decide whether the draft should be automatically saved to `page`.
 * The draft is only ever saved to the page it was hydrated from.
 */
export function shouldAutosave(state: DraftState, page: Pick<ServerSnapshot, 'id'> | null | undefined): boolean {
  if (state.conflicted) return false;
  const { synced } = state;
  if (!page || !synced || synced.id !== page.id) {
    return false;
  }
  if (!isDirty(state)) {
    return false;
  }
  // Hydration above checks page identity before saving. Empty content alone
  // cannot distinguish a load race from a deliberate Select All → Delete.
  return true;
}

/**
 * Whether the draft must be saved: it differs from the server copy it mirrors,
 * or from `pending`, the last write still pending, which the server holds once it
 * lands. Undoing back to the stored text while a write is in flight is then
 * still saved after it (#728).
 */
export function shouldSaveDraft(
  state: DraftState,
  page: Pick<ServerSnapshot, 'id'> | null | undefined,
  pending: Pick<ServerSnapshot, 'id' | 'title' | 'content'> | undefined,
): boolean {
  if (shouldAutosave(state, page)) return true;
  const { synced } = state;
  if (!pending || !synced || pending.id !== synced.id) return false;
  return shouldAutosave({ ...state, synced: { ...synced, title: pending.title, content: pending.content } }, page);
}

export const isEditorRevisionConflict = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'page:revision_conflict';

/**
 * The server stored other text than the draft, again when it was sent once more:
 * re-sending cannot converge. It is reviewed like a revision conflict, so saving
 * pauses and the author compares the saved version with their draft (#757).
 */
export const normalizedSaveConflict = (id: string): Error & { code: 'page:revision_conflict'; details: { id: string; reason: 'normalized' } } =>
  Object.assign(new Error('The server stored other text than this draft.'), {
    code: 'page:revision_conflict' as const,
    details: { id, reason: 'normalized' as const },
  });

/**
 * A page's final draft that an unmounted editor could not save (#789): its save
 * failed or raised a conflict after the editor was gone, so no banner could say
 * so. `base` is the revision the server held as far as that editor knew.
 */
export interface UnsavedDraft extends DraftSnapshot {
  id: string;
  base: string | undefined;
  error: unknown;
}

/**
 * Unsaved final drafts, kept outside the editor's lifetime, one per page, for
 * the next editor that shows the page to take back. A draft the server is later
 * seen to store is dropped: it is saved, not unsaved.
 */
export function createUnsavedDrafts() {
  const drafts = new Map<string, UnsavedDraft>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of listeners) listener();
  };
  return {
    keep(draft: UnsavedDraft) {
      drafts.set(draft.id, draft);
      changed();
    },
    /** The server stored `page`: a kept draft of the same text is no longer unsaved. */
    stored(page: { id: string } & DraftSnapshot) {
      const kept = drafts.get(page.id);
      if (kept && kept.title === page.title && kept.content === page.content) {
        drafts.delete(page.id);
        changed();
      }
    },
    peek: (id: string): UnsavedDraft | undefined => drafts.get(id),
    take(id: string): UnsavedDraft | undefined {
      const kept = drafts.get(id);
      if (kept) {
        drafts.delete(id);
        changed();
      }
      return kept;
    },
    clear() {
      if (drafts.size === 0) return;
      drafts.clear();
      changed();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** This session's unsaved drafts (the editor route mounts and unmounts; they stay). */
export const unsavedDrafts = createUnsavedDrafts();

/**
 * How a kept draft returns to an editor that shows its page as `synced`, with no
 * edit of its own yet: `null` when the server holds it already; `'conflict'` when
 * its save raised one, or the server has moved on from the revision it was meant
 * for (another client's copy is never overwritten without a review); otherwise
 * `'draft'`, a draft like any other, saved over the same revision as before.
 */
export function restoreUnsavedDraft(kept: UnsavedDraft, synced: ServerSnapshot): 'draft' | 'conflict' | null {
  if (kept.id !== synced.id || (kept.title === synced.title && kept.content === synced.content)) return null;
  return isEditorRevisionConflict(kept.error) || kept.base !== synced.updatedAt ? 'conflict' : 'draft';
}

/** The server refused the draft for its size: saving the same text again fails the same way. */
export const isPageTooLarge = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'page:too_large';

/** A pending older write can make a currently clean draft dirty on the server. */
export function shouldFlushDraft(
  state: DraftState,
  page: Pick<ServerSnapshot, 'id'> | null | undefined,
  hasPending: boolean,
  saveFailed = false,
): boolean {
  return Boolean(page && state.synced?.id === page.id && (shouldAutosave(state, page) || hasPending || saveFailed));
}

/**
 * A draft that can no longer be saved: the person was made a Viewer while it
 * had unsaved changes. Leaving must then ask (keep it on screen to copy, or
 * discard it) instead of retrying a save the server will refuse forever.
 */
export function draftUnsavable(viewOnly: boolean, state: DraftState, page: Pick<ServerSnapshot, 'id'> | null | undefined): boolean {
  return viewOnly && shouldAutosave(state, page);
}

/**
 * Whether the editor offers AI assist: `'shown'`, `'loading'` (a placeholder
 * tab) or `'hidden'`. A failed capability request is unknown, not "no", so the
 * panel stays reachable to report it, except a 403: the person may not draft
 * here (their role changed), which is a settled "no".
 */
export function aiAssistState(
  viewOnly: boolean,
  capability: { isPending: boolean; isError: boolean; error?: unknown; data?: { reason: string | null } | undefined },
): 'shown' | 'loading' | 'hidden' {
  if (viewOnly) return 'hidden';
  if (capability.isPending) return 'loading';
  if (capability.data) return capability.data.reason !== 'not_configured' ? 'shown' : 'hidden';
  if (!capability.isError) return 'hidden';
  const status = (capability.error as { status?: unknown } | null | undefined)?.status;
  return status === 403 ? 'hidden' : 'shown';
}
