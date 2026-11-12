import { useT } from '@nibleaf/i18n/react';
import type { SaveWorkspaceAiConnectionBody, WorkspaceAiModelsBody, WorkspaceAiSelectionBody } from '@nibleaf/validators';
import { useSessionMutation as useMutation, useSessionQueryClient as useQueryClient } from '@/integrations/tanstack-query/session-cache';
import { api } from '@/services/api';
import { ApiResponseError, mutateData } from './client-helpers';
import { friendlyErrorMessage } from './errors';
import { queryKeys } from './query-keys';

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

/**
 * Checks a key with its provider and lists its models. A new key being tried
 * isn't stored; a check of the saved key (no `apiKey`) records what it learned
 * on the server, so the site's AI status is read again once it settles, either
 * way. That lives on the mutation, so it runs even if the form has gone.
 */
export const useWorkspaceAiModels = (projectId: string) => {
  const client = useQueryClient();
  const errorMessage = useProviderErrorMessage();
  return useMutation({
    gcTime: 0,
    mutationFn: async (json: WorkspaceAiModelsBody) =>
      mutateData(await api.app.projects[':projectId'].settings.ai.models.$post({ param: { projectId }, json }), 'Could not verify the provider.'),
    onSettled: async (_data, _error, json) => {
      if (!json.apiKey) await client.invalidateQueries({ queryKey: queryKeys.workspaceAi.detail(projectId) });
    },
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
