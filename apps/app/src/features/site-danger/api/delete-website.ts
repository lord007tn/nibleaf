import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useDeleteProject } from '@/hooks/api';
import { organizationKeys } from '@/hooks/api/organization-keys';
import { organizationProjectsQueryOptions } from '@/hooks/api/organization-query-options';
import { queryKeys } from '@/hooks/api/query-keys';
import { projectQueryOptions } from '@/hooks/api/query-options';
import { deleteMayHaveHappened, websiteIsGone } from '../model/delete';

/**
 * Deletes a website. Class: server-confirmed (operations/ui-overhaul.md §8.2).
 *
 * When the request fails in a way that doesn't prove the website still exists
 * (a lost response, a timeout, a server error, "not found" on a retry), it
 * asks the server which websites the person can still see: the organization's
 * list, or the website itself outside an organization. If the website is
 * gone, its caches are cleared and the delete counts as done; otherwise the
 * original failure stands.
 */
export function useDeleteWebsite(organizationId: string | undefined) {
  const queryClient = useQueryClient();
  const remove = useDeleteProject();
  const { mutateAsync } = remove;

  const isGone = useCallback(
    async (websiteId: string) => {
      if (organizationId) {
        const websites = await queryClient.fetchQuery({ ...organizationProjectsQueryOptions(organizationId), staleTime: 0 });
        return websiteIsGone(websites, websiteId);
      }
      try {
        await queryClient.fetchQuery({ ...projectQueryOptions(websiteId), staleTime: 0, retry: false });
        return false;
      } catch (error) {
        return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 404;
      }
    },
    [organizationId, queryClient],
  );

  const forget = useCallback(
    async (websiteId: string) => {
      queryClient.removeQueries({ queryKey: queryKeys.projects.detail(websiteId), exact: true });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.organizations.all() }),
        queryClient.invalidateQueries({ queryKey: organizationKeys.me.switcher() }),
      ]);
    },
    [queryClient],
  );

  const deleteWebsite = useCallback(
    async (websiteId: string) => {
      try {
        await mutateAsync(websiteId);
      } catch (error) {
        if (!deleteMayHaveHappened(error)) throw error;
        // Only a confirmed absence turns a failure into success; a failed check keeps the original error.
        const gone = await isGone(websiteId).catch(() => false);
        if (!gone) throw error;
        await forget(websiteId);
      }
    },
    [forget, isGone, mutateAsync],
  );

  return { deleteWebsite, isPending: remove.isPending };
}
