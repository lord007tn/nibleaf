import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';
import type { Page } from './types';

/*
 * Trash (AUTH-12) data. Editor-only on purpose: it is not re-exported from the
 * `@/hooks/api` barrel, so dashboard routes never bundle it.
 */

type PageKind = 'PAGE' | 'GROUP';

/** A deleted page or group kept in Trash for 30 days (never its content). */
export interface PageTrashItem {
  id: string;
  rootPageId: string;
  branchId: string;
  languageId: string;
  parentId: string | null;
  title: string;
  kind: PageKind;
  /** Pages in the deleted subtree, the root included. */
  pageCount: number;
  deletedAt: string;
  expiresAt: string;
  /** Null when the person who deleted it no longer has an account. */
  deletedBy: { id: string; name: string; email: string; image: string | null } | null;
}

/** What restoring from Trash answers: the restored root page, and whether it
 *  needed a new address or lost its parent group. */
export interface RestoredPage {
  page: Page;
  restoredPages: number;
  slugChanged: boolean;
  movedToTopLevel: boolean;
}

/** How many items a branch's Trash holds (the default branch when omitted).
 *  A cheap read for the page tree's footer; it never purges. */
export const pageTrashCountQueryOptions = (projectId: string | undefined, branchId?: string) =>
  queryOptions({
    queryKey: queryKeys.pageTrash.count(projectId ?? '', branchId),
    queryFn: projectId
      ? async () =>
          getData<{ count: number }>(
            await api.app.projects[':projectId']['page-trash'].count.$get({ param: { projectId }, query: branchId ? { branchId } : {} }),
            'trash',
          )
      : skipToken,
  });

/** A branch's Trash, newest first: read only while the Trash dialog is open. */
export const pageTrashQueryOptions = (projectId: string | undefined, branchId?: string) =>
  queryOptions({
    queryKey: queryKeys.pageTrash.list(projectId ?? '', branchId),
    queryFn: projectId
      ? async () =>
          getData<PageTrashItem[]>(
            await api.app.projects[':projectId']['page-trash'].$get({ param: { projectId }, query: branchId ? { branchId } : {} }),
            'trash',
          )
      : skipToken,
  });

export const usePageTrashCount = (projectId: string | undefined, branchId?: string) => useQuery(pageTrashCountQueryOptions(projectId, branchId));

export const usePageTrash = (projectId: string | undefined, branchId?: string, enabled = true) =>
  useQuery({ ...pageTrashQueryOptions(projectId, branchId), enabled });

/** Put a trashed page (and the pages inside it) back in the tree. Undo on the
 *  delete toast and Restore in Trash both use it. */
export const useRestorePageTrash = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (trashId: string) =>
      mutateData<RestoredPage>(
        await api.app.projects[':projectId']['page-trash'][':id'].restore.$post({ param: { projectId, id: trashId }, json: {} }),
        'Could not restore the page.',
      ),
    onSuccess: (restored) => {
      qc.setQueryData(queryKeys.pages.detail(projectId, restored.page.id), restored.page);
      void qc.invalidateQueries({ queryKey: queryKeys.deployments.changes(projectId) });
      void qc.invalidateQueries({ queryKey: queryKeys.pageTrash.all(projectId) });
      return qc.invalidateQueries({ queryKey: queryKeys.pages.allForProject(projectId) });
    },
  });
};

/** Delete forever. */
export const usePurgePageTrash = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (trashId: string) =>
      mutateData(
        await api.app.projects[':projectId']['page-trash'][':id'].$delete({ param: { projectId, id: trashId } }),
        'Could not delete the page forever.',
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.pageTrash.all(projectId) }),
  });
};
