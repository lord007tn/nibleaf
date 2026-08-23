import {
  searchConfigurationResultSchema,
  searchIndexDiagnosticsResultSchema,
  type UpdateProjectSearchConfigurationBody,
  updateProjectSearchConfigurationBody,
} from '@nibleaf/validators';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { queryKeys } from './query-keys';

export const useProjectSearchConfiguration = (projectId: string) =>
  useQuery({
    queryKey: queryKeys.projectSearch.configuration(projectId),
    queryFn: async () =>
      searchConfigurationResultSchema.parse(
        await getData(await api.app.projects[':projectId'].settings.search.$get({ param: { projectId } }), 'search configuration'),
      ),
  });

export const useUpdateProjectSearchConfiguration = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateProjectSearchConfigurationBody) =>
      mutateData(
        await api.app.projects[':projectId'].settings.search.$patch({
          param: { projectId },
          json: updateProjectSearchConfigurationBody.parse(body),
        }),
        'Could not update search configuration.',
      ),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.projectSearch.configuration(projectId), data);
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.site.shell(projectId) });
      queryClient.invalidateQueries({ queryKey: ['site', projectId, 'search'] });
    },
  });
};

export const useProjectSearchIndexDiagnostics = (projectId: string, cursor?: string, limit = 10) =>
  useQuery({
    queryKey: queryKeys.projectSearch.index(projectId, cursor, limit),
    queryFn: async () =>
      getData(
        await api.app.projects[':projectId'].settings.search.diagnostics.$get({
          param: { projectId },
          query: { limit: String(limit), ...(cursor ? { cursor } : {}) },
        }),
        'search index diagnostics',
      ).then((data) => searchIndexDiagnosticsResultSchema.parse(data)),
    refetchInterval: (query) => (query.state.data?.health === 'indexing' ? 2000 : false),
  });

export const useCreateProjectSearchReindex = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      mutateData(await api.app.projects[':projectId'].settings.search.reindex.$post({ param: { projectId } }), 'Could not queue search indexing.'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectSearch.allIndex(projectId) }),
  });
};
