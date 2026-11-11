/**
 * The one place that decides whether this tab may recover by loading a
 * document again: after a stale-deploy chunk failure (lib/chunk-reload.ts)
 * and after a reader navigation whose data couldn't load
 * (lib/site-link-navigation.ts). Both paths share one budget, so a single
 * failure can never trigger two reloads, and nothing can loop:
 *
 * - one recovery per document: the first path to claim it wins;
 * - one per key (a chunk, or a destination URL) within that key's TTL;
 * - at most MAX_PER_SESSION recoveries per tab session, whatever failed
 *   (a key that recovers again after its TTL uses another one).
 *
 * Without session storage there is no loop guard, so there's no recovery.
 *
 * It also knows when the only loads in flight are speculative (a prefetch on
 * hover or idle, not a page the reader asked for). A chunk failing then must
 * never reload the page someone is reading.
 */

const STORAGE_KEY = 'nibleaf.document-recovery';
const MAX_PER_SESSION = 2;
/** Stored entries are capped whatever is in storage. */
const MAX_ENTRIES = 20;

/** Documents that already started a recovery: later failures before it happens
 *  don't use another slot. Keyed by the document's Location (one per document). */
const recoveringDocuments = new WeakSet<object>();

/** Valid recoveries from storage: a list of [key, timestamp] pairs, newest first, capped. */
const readEntries = (raw: string | null): Array<[string, number]> => {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(
      (entry): entry is [string, number] =>
        Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string' && typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    )
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_ENTRIES);
};

/**
 * Claims the right to recover for `key` now. True means the caller should
 * reload or load the document; the claim is recorded before returning.
 * `ttlMs` is how long a recovery for this key blocks another one for it:
 * a chunk that failed again after a reload never gets a second (Infinity).
 */
export function claimDocumentRecovery(key: string, { ttlMs = Number.POSITIVE_INFINITY, now = Date.now() } = {}): boolean {
  if (recoveringDocuments.has(window.location)) return false;
  try {
    const entries = readEntries(window.sessionStorage.getItem(STORAGE_KEY));
    if (entries.some(([entry, at]) => entry === key && now - at < ttlMs)) return false;
    if (entries.length >= MAX_PER_SESSION) return false;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([[key, now], ...entries].slice(0, MAX_ENTRIES)));
  } catch {
    return false;
  }
  recoveringDocuments.add(window.location);
  return true;
}

let speculativeLoads = 0;
let navigationPending = false;

/** Runs a load the reader didn't ask for yet (a prefetch). */
export async function runSpeculative<T>(load: () => Promise<T>): Promise<T> {
  speculativeLoads += 1;
  try {
    return await load();
  } finally {
    speculativeLoads -= 1;
  }
}

/** The reader is (or stops) waiting for a page they asked for. */
export function setNavigationPending(pending: boolean): void {
  navigationPending = pending;
}

/** Only prefetches are loading: a failure now concerns nothing on screen. */
export function onlySpeculativeLoads(): boolean {
  return speculativeLoads > 0 && !navigationPending;
}
