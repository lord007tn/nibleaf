import { isEditorRevisionConflict } from './editor-draft';

export interface PageDraft {
  id: string;
  title: string;
  content: string;
  expectedUpdatedAt?: string;
}

/** Serialize writes so an older request can never overwrite a newer draft. */
export function createEditorSaveQueue<T>(save: (draft: PageDraft) => Promise<T>, revisionOf?: (saved: T) => string | undefined) {
  let tail: Promise<unknown> = Promise.resolve();
  let latest: { draft: PageDraft; result: Promise<T> } | undefined;
  let pending = 0;
  const revisions = new Map<string, string>();
  const conflicts = new Map<string, unknown>();

  return {
    save(draft: PageDraft): Promise<T> {
      if (latest && latest.draft.id === draft.id && latest.draft.title === draft.title && latest.draft.content === draft.content) {
        return latest.result;
      }
      const result = tail
        .catch(() => undefined)
        .then(async () => {
          if (conflicts.has(draft.id)) throw conflicts.get(draft.id);
          const expectedUpdatedAt = revisions.get(draft.id) ?? draft.expectedUpdatedAt;
          try {
            const saved = await save({ ...draft, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) });
            const revision = revisionOf?.(saved);
            if (revision) revisions.set(draft.id, revision);
            return saved;
          } catch (error) {
            if (isEditorRevisionConflict(error)) conflicts.set(draft.id, error);
            throw error;
          }
        });
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
    settled: () => tail,
    resolveConflict: (id: string, revision: string) => {
      revisions.set(id, revision);
      conflicts.delete(id);
    },
  };
}
