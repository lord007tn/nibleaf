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

/** The same title and content for the same page, whatever revision each was based on. */
const sameStoredText = (a: PageDraft, b: PageDraft): boolean => a.id === b.id && a.title === b.title && a.content === b.content;

/** Serialize writes so an older request can never overwrite a newer draft. */
export function createEditorSaveQueue<T>(save: (draft: PageDraft) => Promise<T>, revisionOf?: (saved: T) => string | undefined) {
  let tail: Promise<unknown> = Promise.resolve();
  let latest: { draft: PageDraft; result: Promise<T> } | undefined;
  let pending = 0;
  const revisions = new Map<string, { revision: string; bases: Set<string> }>();
  const conflicts = new Map<string, unknown>();

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
          if (revision) {
            const bases = ownBase ? acknowledged.bases : new Set<string>();
            if (expectedUpdatedAt) bases.add(expectedUpdatedAt);
            bases.add(revision);
            // Evicted old bases fail closed with their original precondition.
            if (bases.size > 128) {
              const oldest = bases.values().next().value;
              if (oldest) bases.delete(oldest);
            }
            revisions.set(draft.id, { revision, bases });
          }
          return saved;
        } catch (error) {
          if (isEditorRevisionConflict(error)) conflicts.set(draft.id, error);
          throw error;
        }
      };
      // The last write still pending stores this very text, only from an older
      // base (a flush ran before it was acknowledged, another after: #735). Once
      // it lands the server holds this draft, so nothing is sent; if it fails,
      // this draft is sent in its place.
      const stored = latest && sameStoredText(latest.draft, draft) ? latest.result : undefined;
      const result = stored ? stored.catch(send) : tail.catch(() => undefined).then(send);
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
    resolveConflict: (id: string, revision: string) => {
      revisions.set(id, { revision, bases: new Set([revision]) });
      conflicts.delete(id);
    },
  };
}
