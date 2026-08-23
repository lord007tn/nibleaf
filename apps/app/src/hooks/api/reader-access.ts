import type { CreateAudienceBody, InviteReaderBody, JwtAccessConfigBody, ProjectAccessModeBody } from '@nibleaf/validators';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';

export interface ReaderAccessData {
  accessMode: 'PUBLIC' | 'WORKSPACE' | 'READERS';
  readers: Array<{
    id: string;
    email: string | null;
    name: string | null;
    status: string;
    audiences: Array<{ audience: { id: string; name: string } }>;
    _count: { sessions: number };
  }>;
  audiences: Array<{
    id: string;
    name: string;
    grants: Array<{ pageId: string | null }>;
    _count: { readers: number };
  }>;
  jwt: {
    enabled: boolean;
    issuer: string;
    audience: string;
    jwksUrl: string | null;
    publicJwks: unknown;
    groupsClaim: string;
    claimMapping: unknown;
    sessionTtlMinutes: number;
    maxTokenAgeSeconds: number;
    clockToleranceSecs: number;
  } | null;
  audit: Array<{ id: string; action: string; createdAt: string }>;
}

export const useReaderAccess = (projectId: string) =>
  useQuery({
    queryKey: queryKeys.readerAccess.detail(projectId),
    queryFn: async () =>
      getData<ReaderAccessData>(await api.app.projects[':projectId']['reader-access'].$get({ param: { projectId } }), 'reader access settings'),
  });

const useReaderAccessMutation = <TVariables, TResult>(projectId: string, mutationFn: (variables: TVariables) => Promise<TResult>) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.readerAccess.detail(projectId) }),
  });
};

export const useUpdateReaderAccessMode = (projectId: string) =>
  useReaderAccessMutation(projectId, async (json: ProjectAccessModeBody) =>
    mutateData(
      await api.app.projects[':projectId']['reader-access'].mode.$put({ param: { projectId }, json }),
      'Could not update the reader access mode.',
    ),
  );

export const useCreateReaderAudience = (projectId: string) =>
  useReaderAccessMutation(projectId, async (json: CreateAudienceBody) =>
    mutateData(
      await api.app.projects[':projectId']['reader-access'].audiences.$post({ param: { projectId }, json }),
      'Could not create the reader audience.',
    ),
  );

export const useDeleteReaderAudience = (projectId: string) =>
  useReaderAccessMutation(projectId, async (audienceId: string) =>
    mutateData(
      await api.app.projects[':projectId']['reader-access'].audiences[':audienceId'].$delete({ param: { projectId, audienceId } }),
      'Could not delete the reader audience.',
    ),
  );

export const useInviteReader = (projectId: string) =>
  useReaderAccessMutation(projectId, async (json: InviteReaderBody) =>
    mutateData<{ activationUrl: string }>(
      await api.app.projects[':projectId']['reader-access'].readers.invite.$post({ param: { projectId }, json }),
      'Could not invite the reader.',
    ),
  );

export const useRevokeReader = (projectId: string) =>
  useReaderAccessMutation(projectId, async (readerId: string) =>
    mutateData(
      await api.app.projects[':projectId']['reader-access'].readers[':readerId'].revoke.$post({ param: { projectId, readerId } }),
      'Could not revoke the reader.',
    ),
  );

export const useUpdateReaderJwt = (projectId: string) =>
  useReaderAccessMutation(projectId, async (json: JwtAccessConfigBody) =>
    mutateData(
      await api.app.projects[':projectId']['reader-access'].jwt.$put({ param: { projectId }, json }),
      'Could not update the reader JWT configuration.',
    ),
  );

export const useTestReaderJwt = (projectId: string) =>
  useMutation({
    mutationFn: async (token: string) =>
      mutateData(
        await api.app.projects[':projectId']['reader-access'].jwt.test.$post({ param: { projectId }, json: { token } }),
        'Could not validate the reader JWT.',
      ),
  });

export const useEmergencyRevokeReaderAccess = (projectId: string) =>
  useReaderAccessMutation(projectId, async (_: undefined) =>
    mutateData(
      await api.app.projects[':projectId']['reader-access']['emergency-revoke'].$post({ param: { projectId } }),
      'Could not revoke reader access.',
    ),
  );
