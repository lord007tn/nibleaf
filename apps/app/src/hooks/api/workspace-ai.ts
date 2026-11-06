import type { SaveWorkspaceAiConnectionBody, WorkspaceAiModelsBody, WorkspaceAiSelectionBody } from '@nibleaf/validators';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';

const key = (projectId: string) => ['workspace-ai', projectId] as const;

export const useWorkspaceAi = (projectId: string) =>
  useQuery({
    queryKey: key(projectId),
    queryFn: async () => getData(await api.app.projects[':projectId'].settings.ai.$get({ param: { projectId } }), 'Smart AI'),
    refetchInterval: (query) => (['PENDING', 'RUNNING'].includes(query.state.data?.index.status ?? '') ? 3000 : false),
  });

export const useWorkspaceAiModels = (projectId: string) =>
  useMutation({
    gcTime: 0,
    mutationFn: async (json: WorkspaceAiModelsBody) =>
      mutateData(await api.app.projects[':projectId'].settings.ai.models.$post({ param: { projectId }, json }), 'Could not verify the provider.'),
  });

export const useSaveWorkspaceAiConnection = (projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: async (json: SaveWorkspaceAiConnectionBody) =>
      mutateData(await api.app.projects[':projectId'].settings.ai.connection.$put({ param: { projectId }, json }), 'Could not save the provider.'),
    onSuccess: (data) => client.setQueryData(key(projectId), data),
  });
};

export const useSelectWorkspaceAi = (projectId: string) => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (json: WorkspaceAiSelectionBody) =>
      mutateData(await api.app.projects[':projectId'].settings.ai.$patch({ param: { projectId }, json }), 'Could not update Smart AI.'),
    onSuccess: async (data) => {
      client.setQueryData(key(projectId), data);
      await client.invalidateQueries({ queryKey: ['projects', projectId] });
    },
  });
};
