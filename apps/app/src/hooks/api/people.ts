import { skipToken, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from './client-helpers';
import { queryKeys } from './query-keys';

/** People from your other administered sites whose name or email starts with
 *  `query`, for a site's invite box (Admins only; empty query → nothing). */
export const useInviteSuggestions = (projectId: string, query: string, options?: { enabled?: boolean }) => {
  const q = query.trim();
  return useQuery({
    queryKey: queryKeys.members.suggestions(projectId, q.toLowerCase()),
    queryFn:
      q && (options?.enabled ?? true)
        ? async () => getData(await api.app.projects[':projectId'].members.suggestions.$get({ param: { projectId }, query: { q } }), 'suggestions')
        : skipToken,
    // No placeholder data: a list for an older query must never be pickable.
    staleTime: 60_000,
  });
};
