import { useT } from '@nibleaf/i18n/react';
import type { SaveWorkspaceAiConnectionBody, WorkspaceAiModelsBody, WorkspaceAiSelectionBody } from '@nibleaf/validators';
import { useQuery } from '@tanstack/react-query';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { ApiResponseError, mutateData } from './client-helpers';
import { friendlyErrorMessage } from './errors';
import { queryKeys } from './query-keys';
import { workspaceAiQueryOptions } from './query-options';

/** While an index run is queued or running, the section follows its status. */
export const useWorkspaceAi = (projectId: string) =>
  useQuery({
    ...workspaceAiQueryOptions(projectId),
    refetchInterval: (query) => (['PENDING', 'RUNNING'].includes(query.state.data?.index.status ?? '') ? 3000 : false),
  });

/** What a failed provider request means, in plain words: a refused key and a
 * change made in another session get their own message. Toasted once by the
 * shared mutation cache. */
const useProviderErrorMessage = () => {
  const t = useT();
  return (error: unknown) =>
    error instanceof ApiResponseError && error.code === 'integration:credentials_invalid'
      ? t('settings.smartAi.invalidKey')
      : friendlyErrorMessage(t, error, 'settings.smartAi.error', { 409: 'settings.smartAi.conflict' });
};

export const useWorkspaceAiModels = (projectId: string) => {
  const errorMessage = useProviderErrorMessage();
  return useMutation({
    gcTime: 0,
    mutationFn: async (json: WorkspaceAiModelsBody) =>
      mutateData(await api.app.projects[':projectId'].settings.ai.models.$post({ param: { projectId }, json }), 'Could not verify the provider.'),
    meta: { errorMessage },
  });
};

export const useSaveWorkspaceAiConnection = (projectId: string) => {
  const client = useQueryClient();
  const errorMessage = useProviderErrorMessage();
  return useMutation({
    gcTime: 0,
    mutationFn: async (json: SaveWorkspaceAiConnectionBody) =>
      mutateData(await api.app.projects[':projectId'].settings.ai.connection.$put({ param: { projectId }, json }), 'Could not save the provider.'),
    onSuccess: async (data) => {
      client.setQueryData(queryKeys.workspaceAi.detail(projectId), data);
      await client.invalidateQueries({ queryKey: queryKeys.workspaceAi.draftCapability(projectId) });
    },
    meta: { errorMessage },
  });
};

export const useSelectWorkspaceAi = (projectId: string) => {
  const client = useQueryClient();
  const errorMessage = useProviderErrorMessage();
  return useMutation({
    mutationFn: async (json: WorkspaceAiSelectionBody) =>
      mutateData(await api.app.projects[':projectId'].settings.ai.$patch({ param: { projectId }, json }), 'Could not update Smart AI.'),
    onSuccess: async (data) => {
      client.setQueryData(queryKeys.workspaceAi.detail(projectId), data);
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) }),
        client.invalidateQueries({ queryKey: queryKeys.workspaceAi.draftCapability(projectId) }),
      ]);
    },
    meta: { errorMessage },
  });
};
