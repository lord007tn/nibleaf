import type { CreateJoinLinkBody } from '@nibleaf/validators';
import { queryOptions, skipToken, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';

const joinLinksQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: queryKeys.members.joinLinks(projectId ?? ''),
    queryFn: projectId
      ? async () => getData(await api.app.projects[':projectId']['join-links'].$get({ param: { projectId } }), 'join links')
      : skipToken,
  });

/** A site's join links with their recent joins (Admins only). */
export const useJoinLinks = (projectId: string | undefined, options?: { enabled?: boolean }) =>
  useQuery({ ...joinLinksQueryOptions(projectId), enabled: options?.enabled ?? true });

export type JoinLink = NonNullable<ReturnType<typeof useJoinLinks>['data']>[number];

/** Each mutation reports its own error inline, so none sets `meta.errorMessage`. */
export const useCreateJoinLink = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateJoinLinkBody) =>
      mutateData(await api.app.projects[':projectId']['join-links'].$post({ param: { projectId }, json: body }), 'Could not create the link.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.joinLinks(projectId) }),
  });
};

export const useRegenerateJoinLink = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(
        await api.app.projects[':projectId']['join-links'][':id'].regenerate.$post({ param: { projectId, id } }),
        'Could not regenerate the link.',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.joinLinks(projectId) }),
  });
};

export const useRevokeJoinLink = (projectId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      mutateData(await api.app.projects[':projectId']['join-links'][':id'].revoke.$post({ param: { projectId, id } }), 'Could not disable the link.'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.members.joinLinks(projectId) }),
  });
};

/** Join the link's site as the signed-in person. */
export const useJoinWithLink = () =>
  useMutation({
    mutationFn: async (token: string) => mutateData(await api.app.join[':token'].$post({ param: { token } }), 'Could not join the site.'),
  });
