import type { AssignableMemberRole } from '@nibleaf/shared/rbac';
import { skipToken, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';
import { peopleQueryOptions } from './query-options';

/** The People page's list for a search (`q`), one page at a time. */
export const usePeople = (q = '') => useInfiniteQuery(peopleQueryOptions(q));
/** One page of the People list: sites you administer, people, and (first page only) invitations. */
export type PeopleOverview = NonNullable<ReturnType<typeof usePeople>['data']>['pages'][number];

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

/**
 * The People page acts on many sites, so each change names its site. Every
 * call goes through that site's own member endpoint and guard; on success the
 * People list and that site's member list are refreshed.
 */
export const usePeopleChanges = () => {
  const qc = useQueryClient();
  const refresh = (projectId: string) =>
    Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.members.people() }),
      qc.invalidateQueries({ queryKey: queryKeys.members.forProject(projectId) }),
      // Who can be suggested depends on every site's membership: drop all of them.
      qc.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'members' && query.queryKey[2] === 'suggestions' }),
    ]);
  const invite = useMutation({
    mutationFn: async ({ projectId, email, role }: { projectId: string; email: string; role: AssignableMemberRole }) =>
      mutateData(
        await api.app.projects[':projectId'].members.invite.$post({ param: { projectId }, json: { email, role } }),
        'Could not send the invite.',
      ),
    onSuccess: (_data, { projectId }) => refresh(projectId),
  });
  const changeRole = useMutation({
    mutationFn: async ({ projectId, memberId, role }: { projectId: string; memberId: string; role: AssignableMemberRole }) =>
      mutateData(
        await api.app.projects[':projectId'].members[':id'].role.$patch({ param: { projectId, id: memberId }, json: { role } }),
        'Could not update the role.',
      ),
    onSuccess: (_data, { projectId }) => refresh(projectId),
  });
  const remove = useMutation({
    mutationFn: async ({ projectId, memberId }: { projectId: string; memberId: string }) =>
      mutateData(await api.app.projects[':projectId'].members[':id'].$delete({ param: { projectId, id: memberId } }), 'Could not remove the member.'),
    onSuccess: (_data, { projectId }) => refresh(projectId),
  });
  const revoke = useMutation({
    mutationFn: async ({ projectId, invitationId }: { projectId: string; invitationId: string }) =>
      mutateData(
        await api.app.projects[':projectId'].members.invitations[':id'].$delete({ param: { projectId, id: invitationId } }),
        'Could not revoke the invitation.',
      ),
    onSuccess: (_data, { projectId }) => refresh(projectId),
  });
  return { invite, changeRole, remove, revoke };
};
