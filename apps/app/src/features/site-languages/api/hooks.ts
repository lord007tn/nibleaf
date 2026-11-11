import { useState } from 'react';
import { useDeleteLanguage, useLanguages, useUpdateLanguage } from '@/hooks/api';
import { NO_PENDING_WRITES, type PendingLanguageWrites } from '../model/languages';

/** The site's languages with their coverage (the same query the General form and the editor use). */
export const useSiteLanguages = (projectId: string) => useLanguages(projectId);

const without = (ids: readonly string[], id: string) => ids.filter((candidate) => candidate !== id);

/**
 * The row actions on the Languages screen, plus which writes are in flight so
 * the model can lock what they affect. Every action returns a promise that
 * rejects on failure; the caller owns the error (a toast for show/hide, the
 * `ActionDialog` for the confirmed ones). The underlying mutations set no
 * `meta.errorMessage`, so the global cache stays quiet.
 *
 * Classes (operations/ui-overhaul.md §8.2), all as before:
 * - `setShown`: server-confirmed, not optimistic (it wasn't before). The row
 *   shows "Saving…" until the language list is refetched.
 * - `makeDefault`: server-confirmed. The server clears the old default and
 *   re-enables the new one, so the whole list is refetched.
 * - `remove`: server-confirmed. It deletes the language's pages too, so pages
 *   and the project are invalidated as well.
 */
export function useLanguageActions(projectId: string) {
  const update = useUpdateLanguage(projectId);
  const deletion = useDeleteLanguage(projectId);
  const [pending, setPending] = useState<PendingLanguageWrites>(NO_PENDING_WRITES);

  const setShown = async (id: string, enabled: boolean) => {
    setPending((current) => ({ ...current, visibility: [...current.visibility, id] }));
    try {
      await update.mutateAsync({ id, body: { enabled } });
    } finally {
      setPending((current) => ({ ...current, visibility: without(current.visibility, id) }));
    }
  };

  const makeDefault = async (id: string) => {
    setPending((current) => ({ ...current, defaultTo: id }));
    try {
      await update.mutateAsync({ id, body: { isDefault: true } });
    } finally {
      setPending((current) => ({ ...current, defaultTo: current.defaultTo === id ? null : current.defaultTo }));
    }
  };

  const remove = async (id: string) => {
    setPending((current) => ({ ...current, removing: [...current.removing, id] }));
    try {
      await deletion.mutateAsync(id);
    } finally {
      setPending((current) => ({ ...current, removing: without(current.removing, id) }));
    }
  };

  return { pending, setShown, makeDefault, remove };
}
