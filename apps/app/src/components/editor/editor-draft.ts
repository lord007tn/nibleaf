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

/** A conflict the editor reviews like the server's revision conflict: saving pauses until the author resolves it. */
export const draftConflict = <R extends string>(
  id: string,
  reason: R,
  message: string,
): Error & { code: 'page:revision_conflict'; details: { id: string; reason: R } } =>
  Object.assign(new Error(message), { code: 'page:revision_conflict' as const, details: { id, reason } });

/**
 * The server stored other text than the draft, again when it was sent once more:
 * re-sending cannot converge. It is reviewed like a revision conflict, so saving
 * pauses and the author compares the saved version with their draft (#757).
 */
export const normalizedSaveConflict = (id: string) => draftConflict(id, 'normalized', 'The server stored other text than this draft.');

/** A draft kept after its editor unmounted comes back over a server copy that moved on since (#789). */
export const restoredDraftConflict = (id: string) => draftConflict(id, 'restored', 'The page changed since this draft was last saved.');

/**
 * A page's latest draft that no editor could show was not saved (#789): its
 * write failed or was refused after the editor unmounted (or moved to another
 * page), or the editor unmounted holding it under an unresolved conflict.
 * `base` is the revision the server held as far as that editor knew.
 */
export interface UnsavedDraft extends DraftSnapshot {
  id: string;
  base: string | undefined;
  error: unknown;
}

/** One write of a page, from when it is queued: the account and session it belongs to, and its place among the writes. */
export interface DraftTicket {
  owner: string;
  generation: number;
  id: string;
  seq: number;
}

/**
 * Unsaved drafts, kept outside the editor's lifetime, for the next editor that
 * shows the page to take back (#789). They are the signed-in account's own:
 *
 * - kept per account and page, and all dropped when the session ends or changes
 *   (`clear`); a write queued in an older session never keeps anything;
 * - only the latest write of a page counts: a failure is kept unless a later
 *   write of that page was kept or stored, and a stored write drops any earlier
 *   one's draft;
 * - an editor takes a draft back only once no write of the page is unsettled.
 */
export function createUnsavedDrafts() {
  let generation = 0;
  let seq = 0;
  const drafts = new Map<string, UnsavedDraft & { seq: number }>();
  const storedUpTo = new Map<string, number>();
  const unsettled = new Map<string, number>();
  const listeners = new Set<() => void>();
  const keyOf = (owner: string, id: string) => JSON.stringify([owner, id]);
  const changed = () => {
    for (const listener of listeners) listener();
  };
  /** The ticket's write settled; false when it belongs to an older session. */
  const settle = (ticket: DraftTicket): boolean => {
    if (ticket.generation !== generation) return false;
    const key = keyOf(ticket.owner, ticket.id);
    const left = (unsettled.get(key) ?? 1) - 1;
    if (left > 0) unsettled.set(key, left);
    else unsettled.delete(key);
    return true;
  };
  return {
    /** A write of page `id` is queued by `owner`'s editor: its ticket, or null when no one is signed in. */
    issue(owner: string | null | undefined, id: string): DraftTicket | null {
      if (!owner) return null;
      seq += 1;
      const key = keyOf(owner, id);
      unsettled.set(key, (unsettled.get(key) ?? 0) + 1);
      return { owner, generation, id, seq };
    },
    /** The write stored its draft: any earlier write's draft kept for the page is out of date. */
    stored(ticket: DraftTicket) {
      if (!settle(ticket)) return;
      const key = keyOf(ticket.owner, ticket.id);
      storedUpTo.set(key, Math.max(storedUpTo.get(key) ?? 0, ticket.seq));
      const kept = drafts.get(key);
      if (kept && kept.seq < ticket.seq) drafts.delete(key);
      changed();
    },
    /** The write failed with no editor to say so: keep its draft, if it is the page's latest. */
    failed(ticket: DraftTicket, draft: UnsavedDraft) {
      if (!settle(ticket)) return;
      const key = keyOf(ticket.owner, ticket.id);
      const kept = drafts.get(key);
      const outdated = ticket.seq <= (storedUpTo.get(key) ?? 0) || (kept !== undefined && kept.seq > ticket.seq);
      if (!outdated && draft.id === ticket.id) drafts.set(key, { ...draft, seq: ticket.seq });
      changed();
    },
    /** The write settled, and its editor shows how (or it no longer counts): nothing to keep. */
    settled(ticket: DraftTicket) {
      if (settle(ticket)) changed();
    },
    /** Whether a write of page `id` by `owner` has not settled yet. */
    pending: (owner: string | null | undefined, id: string): boolean => Boolean(owner) && unsettled.has(keyOf(owner as string, id)),
    peek(owner: string | null | undefined, id: string): UnsavedDraft | undefined {
      return owner ? drafts.get(keyOf(owner, id)) : undefined;
    },
    take(owner: string | null | undefined, id: string): UnsavedDraft | undefined {
      if (!owner) return undefined;
      const key = keyOf(owner, id);
      const kept = drafts.get(key);
      if (kept) {
        drafts.delete(key);
        changed();
      }
      return kept;
    },
    /** The session ended or changed: drop every draft, and ignore writes queued before. */
    clear() {
      generation += 1;
      drafts.clear();
      storedUpTo.clear();
      unsettled.clear();
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
