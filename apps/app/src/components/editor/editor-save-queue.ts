export interface PageDraft {
  id: string;
  title: string;
  content: string;
}

/** Serialize writes so an older request can never overwrite a newer draft. */
export function createEditorSaveQueue<T>(save: (draft: PageDraft) => Promise<T>) {
  let tail: Promise<unknown> = Promise.resolve();
  let latest: { draft: PageDraft; result: Promise<T> } | undefined;
  let pending = 0;

  return {
    save(draft: PageDraft): Promise<T> {
      if (latest && latest.draft.id === draft.id && latest.draft.title === draft.title && latest.draft.content === draft.content) {
        return latest.result;
      }
      const result = tail.catch(() => undefined).then(() => save(draft));
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
  };
}
