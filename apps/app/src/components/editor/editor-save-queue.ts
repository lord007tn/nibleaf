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

/** Serialize writes so an older request can never overwrite a newer draft. */
export function createEditorSaveQueue<T>(
  save: (draft: PageDraft) => Promise<T>,
  revisionOf?: (saved: T) => string | undefined,
  storedOf?: (saved: T) => StoredPage | undefined,
) {
  let tail: Promise<unknown> = Promise.resolve();
  let latest: { draft: PageDraft; result: Promise<T> } | undefined;
  let pending = 0;
  /** Every draft sent or queued that has not settled yet. */
  const unsettled = new Set<PageDraft>();
  const revisions = new Map<string, { revision: string; bases: Set<string> }>();
  const conflicts = new Map<string, unknown>();
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

  return {
    save(draft: PageDraft): Promise<T> {
      if (latest && samePageDraft(latest.draft, draft)) return latest.result;
      const send = async (): Promise<T> => {
        if (conflicts.has(draft.id)) throw conflicts.get(draft.id);
        const acknowledged = revisions.get(draft.id);
        const ownBase = acknowledged && (!draft.expectedUpdatedAt || acknowledged.bases.has(draft.expectedUpdatedAt));
        const expectedUpdatedAt = ownBase ? acknowledged.revision : draft.expectedUpdatedAt;
        try {
          const saved = await save({ ...draft, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) });
          const revision = revisionOf?.(saved);
          if (revision) acknowledge(draft.id, expectedUpdatedAt, revision);
          return saved;
        } catch (error) {
          if (isEditorRevisionConflict(error)) conflicts.set(draft.id, error);
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
      unsettled.add(draft);
      latest = entry;
      tail = result;
      // Deduplicate only in-flight writes. The same content may need saving
      // again after a server refresh or after a failed request.
      const release = () => {
        pending -= 1;
        unsettled.delete(draft);
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
    /** Whether a write of page `id` not settled yet carries this title and content. */
    carries: (id: string, text: Omit<StoredPage, 'id'>): boolean => {
      for (const draft of unsettled) if (sameStoredText(draft, { id, ...text })) return true;
      return false;
    },
    /** The editor found a conflict on page `id` itself (#790): its writes not sent
     *  yet are refused with `error` until it is resolved, like the server's. */
    raiseConflict: (id: string, error: unknown) => {
      conflicts.set(id, error);
    },
    resolveConflict: (id: string, revision: string) => {
      revisions.set(id, { revision, bases: new Set([revision]) });
      conflicts.delete(id);
    },
  };
}
