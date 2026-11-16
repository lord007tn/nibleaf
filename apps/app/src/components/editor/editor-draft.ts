import { onSessionCleared } from '@/lib/session-cleared';

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

/** What the editor knows of its own writes of a page, to tell its own copies from another client's (#790). */
export interface OwnWrites {
  /** A write sent to the server (its response not back) carries this text. A draft only queued carries nothing. */
  carries?: (text: DraftSnapshot) => boolean;
  /** `copy` may be the editor's own: a revision its writes stored, or the
   *  stored form of a write still at the server, which it may have stored as
   *  other text (normalized) and whose response, telling which, is not back. */
  mayBeOwn?: (copy: ServerSnapshot) => boolean;
}

/**
 * Whether `page` is another client's newer copy that arrived while the draft
 * holds a change of the author's not sent yet (#790). It cannot be loaded
 * without discarding that change, and saving over it without asking would
 * discard theirs; leaving it unloaded let an undo back to the loaded text look
 * clean while the server held their copy. So it is a revision conflict at once:
 * saving pauses for the author to review. "Clean" then means what the server
 * holds now, not what was loaded.
 *
 * Not a conflict: a copy holding the draft's own text or the text it mirrors; a
 * copy that is, or may be, one of the editor's own writes (`own`), including a
 * normalized one: while a write is at the server, a newer copy is told apart
 * once its response says what it stored; a draft whose text a sent write
 * carries (nothing unsent); a copy without comparable stamps, or one the
 * editor's own writes have moved on from (`superseded`).
 */
export function foreignCopyWhileDirty(
  state: DraftState,
  page: ServerSnapshot | null | undefined,
  superseded?: (revision: string) => boolean,
  own: OwnWrites = {},
): boolean {
  const { synced, draft } = state;
  if (!page || state.conflicted || !synced || synced.id !== page.id || !isDirty(state)) return false;
  const holds = (text: DraftSnapshot) => page.title === text.title && page.content === text.content;
  if (holds(synced) || holds(draft) || own.carries?.(page) || own.carries?.(draft) || own.mayBeOwn?.(page)) return false;
  if (page.updatedAt === undefined || synced.updatedAt === undefined) return false;
  const next = Date.parse(page.updatedAt);
  const current = Date.parse(synced.updatedAt);
  return !Number.isNaN(next) && !Number.isNaN(current) && next > current && !superseded?.(page.updatedAt);
}

/**
 * Where a link destination may start: after `](` or a definition's `[label]:`,
 * and any whitespace, line endings included, then `<` for the bracketed form.
 * The openings the server's `rewrite-page-links.ts` matches at a parsed link or
 * definition, found here wherever they occur (a label is at most 999
 * characters, as in CommonMark).
 */
const DESTINATION_OPENING = /\]\(\s*(<?)|\[(?:\\.|[^\]\\]){0,999}\]:\s*(<?)/g;

/**
 * `content` with every link destination the server may rewrite taken out. The
 * destination is scanned as `rewrite-page-links.ts` scans it: a bracketed one up
 * to `>` (it holds no line ending), any other up to whitespace or an unbalanced
 * `)`, skipping escaped characters. It also takes out destinations the server
 * leaves (in code, HTML or images), so two texts it calls equal may differ there:
 * wider than the server, never narrower.
 */
function withoutLinkDestinations(content: string): string {
  let out = '';
  let from = 0;
  DESTINATION_OPENING.lastIndex = 0;
  for (let opening = DESTINATION_OPENING.exec(content); opening; opening = DESTINATION_OPENING.exec(content)) {
    const bracketed = (opening[1] ?? opening[2]) === '<';
    const start = opening.index + opening[0].length;
    let end = start;
    let depth = 0;
    for (; end < content.length; end++) {
      const char = content[end] as string;
      if (char === '\\') {
        end++;
        continue;
      }
      if (bracketed) {
        if (char === '>' || char === '\n') break;
      } else {
        if ((char === ')' && depth === 0) || /\s/.test(char)) break;
        if (char === '(') depth++;
        if (char === ')') depth--;
      }
    }
    end = Math.min(end, content.length);
    out += content.slice(from, start);
    from = end;
    DESTINATION_OPENING.lastIndex = Math.max(end, opening.index + 1);
  }
  return out + content.slice(from);
}

/**
 * Whether `copy`, a newer revision of the page that arrived while `write` was
 * at the server, may be that write as the server stored it (#825). The server
 * changes a page's text only by rewriting its link destinations to moved
 * addresses (`rewrite-page-links.ts` on the server), so the copy must be newer
 * than the revision the write was sent from and hold the write's title and
 * content, link destinations aside (`withoutLinkDestinations`).
 */
export function mayBeNormalizedWrite(copy: ServerSnapshot, write: DraftSnapshot & { base?: string }): boolean {
  if (copy.title !== write.title || copy.updatedAt === undefined) return false;
  if (write.base !== undefined) {
    const next = Date.parse(copy.updatedAt);
    const base = Date.parse(write.base);
    if (Number.isNaN(next) || Number.isNaN(base) || next <= base) return false;
  }
  return withoutLinkDestinations(copy.content) === withoutLinkDestinations(write.content);
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
const draftConflict = <R extends string>(
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

/** Another client's copy arrived while the draft held unsent changes (#790): reviewed like a revision conflict. */
export const foreignCopyConflict = (id: string) => draftConflict(id, 'foreign', 'Another client saved this page while it had unsaved changes.');

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
  /** Per page, the latest write whose failure an editor showed: an older failure is out of date. */
  const reportedUpTo = new Map<string, number>();
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
      const outdated =
        ticket.seq <= (storedUpTo.get(key) ?? 0) || ticket.seq <= (reportedUpTo.get(key) ?? 0) || (kept !== undefined && kept.seq > ticket.seq);
      if (!outdated && draft.id === ticket.id) drafts.set(key, { ...draft, seq: ticket.seq });
      changed();
    },
    /** The write settled, and its editor shows how (or it no longer counts): nothing to keep
     *  for it. `shown`: the editor showed its author that this write failed. */
    settled(ticket: DraftTicket, shown = false) {
      if (!settle(ticket)) return;
      if (shown) {
        // A later write of the page failed on screen: an earlier write's draft is out of date.
        // (A later write that fails out of sight, even of the same text, is still kept.)
        const key = keyOf(ticket.owner, ticket.id);
        reportedUpTo.set(key, Math.max(reportedUpTo.get(key) ?? 0, ticket.seq));
        const kept = drafts.get(key);
        if (kept && kept.seq < ticket.seq) drafts.delete(key);
      }
      changed();
    },
    /** The session the store is in: it moves on each time the session ends or changes (`clear`). */
    generation: (): number => generation,
    /** Whether a write of page `id` by `owner` has not settled yet. */
    pending: (owner: string | null | undefined, id: string): boolean => Boolean(owner) && unsettled.has(keyOf(owner as string, id)),
    peek(owner: string | null | undefined, id: string): UnsavedDraft | undefined {
      return owner ? drafts.get(keyOf(owner, id)) : undefined;
    },
    /** An editor holds the kept draft under its unresolved conflict, edited since: keep that text instead. */
    revise(owner: string | null | undefined, id: string, text: DraftSnapshot) {
      if (!owner) return;
      const key = keyOf(owner, id);
      const kept = drafts.get(key);
      if (!kept || (kept.title === text.title && kept.content === text.content)) return;
      drafts.set(key, { ...kept, title: text.title, content: text.content });
      changed();
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
      reportedUpTo.clear();
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
// They are the signed-in account's: signing out or switching accounts drops them.
onSessionCleared(() => unsavedDrafts.clear());

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
