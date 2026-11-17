import { isEditorRevisionConflict } from './editor-draft';

export interface PageDraft {
  id: string;
  title: string;
  content: string;
  expectedUpdatedAt?: string;
}

/** The same draft of the same page, against the same revision. */
export const samePageDraft = (a: PageDraft, b: PageDraft): boolean =>
  a.id === b.id && a.title === b.title && a.content === b.content && a.expectedUpdatedAt === b.expectedUpdatedAt;

/** What a write's response says the server stored. */
export interface StoredPage {
  id: string;
  title: string;
  content: string;
}

/** The same title and content for the same page, whatever revision each was based on. */
const sameStoredText = (a: StoredPage, b: StoredPage): boolean => a.id === b.id && a.title === b.title && a.content === b.content;

/** A write of a page queued before its conflict was resolved: the review replaced it, so it is not sent. */
export const isSupersededWrite = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'page:write_superseded';

/** What the save callback is told about the write it sends. */
export interface QueuedWrite {
  /** The page's conflict was resolved since this write was queued: its outcome no longer counts. */
  stale: () => boolean;
}

/** Serialize writes so an older request can never overwrite a newer draft. */
export function createEditorSaveQueue<T>(
  save: (draft: PageDraft, write: QueuedWrite) => Promise<T>,
  revisionOf?: (saved: T) => string | undefined,
  storedOf?: (saved: T) => StoredPage | undefined,
) {
  let tail: Promise<unknown> = Promise.resolve();
  let latest: { draft: PageDraft; result: Promise<T> } | undefined;
  let pending = 0;
  /** Drafts sent to the server whose response has not come back, with the revision each was sent from: what it may hold already. */
  const sent = new Map<PageDraft, string | undefined>();
  const revisions = new Map<string, { revision: string; bases: Set<string> }>();
  const conflicts = new Map<string, unknown>();
  /** Per page, how many times its conflict was resolved: a write queued before a resolution is stale. */
  const resolutions = new Map<string, number>();
  const resolutionOf = (id: string) => resolutions.get(id) ?? 0;
  /** The revisions this queue's own writes produced, per page. */
  const produced = new Map<string, Set<string>>();
  const ownRevision = (id: string, revision: string | undefined) => revision !== undefined && produced.get(id)?.has(revision) === true;
  /** The server stored a write of page `id` sent from `base` at `revision`. */
  const acknowledge = (id: string, base: string | undefined, revision: string) => {
    // Read now, not when the write was sent: the save callback may have
    // acknowledged a revision of its own in between (#757).
    const known = revisions.get(id);
    const bases = known && (!base || known.bases.has(base)) ? known.bases : new Set<string>();
    if (base) bases.add(base);
    bases.add(revision);
    // Evicted old bases fail closed with their original precondition.
    if (bases.size > 128) {
      const oldest = bases.values().next().value;
      if (oldest) bases.delete(oldest);
    }
    revisions.set(id, { revision, bases });
    const mine = produced.get(id) ?? new Set<string>();
    mine.add(revision);
    if (mine.size > 128) mine.delete(mine.values().next().value as string);
    produced.set(id, mine);
  };

  /** The revision a draft of a page is sent from: the latest this queue's own writes stored, if it is based on one of them. */
  const baseFor = (draft: PageDraft): string | undefined => {
    const acknowledged = revisions.get(draft.id);
    const ownBase = acknowledged && (!draft.expectedUpdatedAt || acknowledged.bases.has(draft.expectedUpdatedAt));
    return ownBase ? acknowledged.revision : draft.expectedUpdatedAt;
  };

  return {
    save(draft: PageDraft): Promise<T> {
      if (latest && samePageDraft(latest.draft, draft)) return latest.result;
      const resolution = resolutionOf(draft.id);
      const stale = () => resolution !== resolutionOf(draft.id);
      const send = async (): Promise<T> => {
        if (conflicts.has(draft.id)) throw conflicts.get(draft.id);
        if (stale()) {
          throw Object.assign(new Error('The conflict review replaced this draft.'), { code: 'page:write_superseded' as const });
        }
        const expectedUpdatedAt = baseFor(draft);
        try {
          sent.set(draft, expectedUpdatedAt);
          const saved = await save({ ...draft, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) }, { stale }).finally(() => {
            sent.delete(draft);
          });
          const revision = revisionOf?.(saved);
          // A write from before a resolution tells nothing about the page now.
          if (revision && !stale()) acknowledge(draft.id, expectedUpdatedAt, revision);
          return saved;
        } catch (error) {
          // Nor does its conflict: the review it would ask for already happened.
          if (isEditorRevisionConflict(error) && !stale()) conflicts.set(draft.id, error);
          throw error;
        }
      };
      // The last write still pending carries this very text, only from another
      // base (a flush ran before it was acknowledged, another after: #735). This
      // draft waits for it, and is skipped only if, once it settles, the server
      // holds exactly this draft from a revision this queue knows: the draft's
      // base is that write's own or one this queue's writes produced (never a
      // foreign server copy), and the response shows this page, title and
      // content stored. Otherwise the draft is sent after it, as before.
      const previous = latest && sameStoredText(latest.draft, draft) ? latest : undefined;
      const storedThisDraft = (saved: T) => {
        const ownBase = draft.expectedUpdatedAt === previous?.draft.expectedUpdatedAt || ownRevision(draft.id, draft.expectedUpdatedAt);
        const stored = storedOf?.(saved);
        return ownBase && stored !== undefined && sameStoredText(stored, draft);
      };
      const result = previous
        ? previous.result.then(
            (saved) => (storedThisDraft(saved) ? saved : send()),
            () => send(),
          )
        : tail.catch(() => undefined).then(send);
      const entry = { draft, result };
      pending += 1;
      latest = entry;
      tail = result;
      // Deduplicate only in-flight writes. The same content may need saving
      // again after a server refresh or after a failed request.
      const release = () => {
        pending -= 1;
        if (latest === entry) latest = undefined;
      };
      void result.then(release, release);
      return result;
    },
    hasPending: () => pending > 0,
    /** The last draft sent that has not settled yet: what the server holds once
     *  every pending write lands. Undefined when nothing is pending. */
    pendingDraft: (): PageDraft | undefined => latest?.draft,
    settled: () => tail,
    /** The save callback sent page `id` from `base` and the server stored it at
     *  `revision`, before the callback returns: it is about to send that page
     *  again (a normalized write, #757). Drafts queued meanwhile, from either
     *  revision, are then sent from the latest one, whatever the callback does. */
    acknowledge,
    /** Whether `revision` of page `id` is one this queue's stored writes were
     *  sent from or replaced: the server has moved on from it (#757). */
    superseded: (id: string, revision: string): boolean => {
      const known = revisions.get(id);
      return known !== undefined && known.revision !== revision && known.bases.has(revision);
    },
    baseFor,
    /** Whether a write of page `id` is at the server, its response not back: a
     *  newer copy of the page may be that write's, stored as other text (#790). */
    inFlight: (id: string): boolean => {
      for (const draft of sent.keys()) if (draft.id === id) return true;
      return false;
    },
    /** The writes of page `id` at the server, their responses not back, each
     *  with the revision it was sent from (#825). */
    sentWrites: (id: string): Array<Omit<StoredPage, 'id'> & { base?: string }> =>
      [...sent].filter(([draft]) => draft.id === id).map(([draft, base]) => ({ title: draft.title, content: draft.content, base })),
    /** Whether a write of page `id` sent to the server carries this title and
     *  content. A draft only queued is not on the server: it carries nothing. */
    carries: (id: string, text: Omit<StoredPage, 'id'>): boolean => {
      for (const draft of sent.keys()) if (sameStoredText(draft, { id, ...text })) return true;
      return false;
    },
    /** Whether `revision` of page `id` is one this queue's own writes stored. */
    ownRevision,
    /** How many times page `id`'s conflict was resolved, to tell a write queued before a resolution. */
    resolution: resolutionOf,
    /** The editor found a conflict on page `id` itself (another client's copy, a
     *  draft restored over a newer copy): its writes are refused with `error`,
     *  without being sent, until it is resolved, like the server's. */
    raiseConflict: (id: string, error: unknown) => {
      conflicts.set(id, error);
    },
    /** Withdraw the conflict the editor raised on page `id` (`error`), if it is
     *  still the one holding the page's writes; true when it was. */
    dropConflict: (id: string, error: unknown): boolean => {
      if (conflicts.get(id) !== error) return false;
      conflicts.delete(id);
      return true;
    },
    /** The author resolved page `id`'s conflict against `revision`. Writes queued
     *  before are not sent, and the outcome of one in flight no longer counts. */
    resolveConflict: (id: string, revision: string) => {
      revisions.set(id, { revision, bases: new Set([revision]) });
      conflicts.delete(id);
      resolutions.set(id, resolutionOf(id) + 1);
    },
  };
}
