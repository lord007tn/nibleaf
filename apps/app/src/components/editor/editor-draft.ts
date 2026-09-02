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
 * - an automatic save only ever runs for the page the draft was hydrated from,
 *   never with an empty body over a non-empty page.
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
 */
export function nextHydration(state: DraftState, page: ServerSnapshot | null | undefined): ServerSnapshot | null {
  if (!page) {
    return null;
  }
  const { synced } = state;
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
  if (changed && isNewerRevision(page, synced)) {
    return snapshotOf(page);
  }
  return null;
}

/**
 * Decide whether the draft should be automatically saved to `page`.
 * The draft is only ever saved to the page it was hydrated from.
 */
export function shouldAutosave(state: DraftState, page: Pick<ServerSnapshot, 'id'> | null | undefined): boolean {
  const { synced, draft } = state;
  if (!page || !synced || synced.id !== page.id) {
    return false;
  }
  if (!isDirty(state)) {
    return false;
  }
  // Data-loss guard: never let an AUTOMATIC save replace a page that has content
  // with an empty body. Protects against a transient empty `content` state (e.g. a
  // hot-reload/Fast-Refresh reset, or a load race) silently wiping the page. A real
  // "clear the page" still persists the moment any character is typed.
  if (draft.content.trim() === '' && synced.content.trim() !== '') {
    return false;
  }
  return true;
}
