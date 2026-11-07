import { useT } from '@nibleaf/i18n/react';
import {
  searchConfigurationResultSchema,
  searchIndexDiagnosticsResultSchema,
  type UpdateProjectSearchConfigurationBody,
  updateProjectSearchConfigurationBody,
} from '@nibleaf/validators';
import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData, mutateData } from './client-helpers';
import { friendlyErrorMessage } from './errors';
import { queryKeys } from './query-keys';

/*
 * Site search settings and index diagnostics. The factories live here, not in
 * ./query-options: they parse responses with validators schemas, which must stay
 * out of the main chunk public pages load. The settings route loader imports
 * this module lazily.
 */

export const projectSearchConfigurationQueryOptions = (projectId: string) =>
  queryOptions({
    queryKey: queryKeys.projectSearch.configuration(projectId),
    queryFn: async () =>
      searchConfigurationResultSchema.parse(
        await getData(await api.app.projects[':projectId'].settings.search.$get({ param: { projectId } }), 'search configuration'),
      ),
  });

/** The section shows the first page of samples, ten at a time. */
const SEARCH_INDEX_SAMPLE_LIMIT = 10;

export const projectSearchIndexDiagnosticsQueryOptions = (projectId: string, cursor?: string, limit = SEARCH_INDEX_SAMPLE_LIMIT) =>
  queryOptions({
    queryKey: queryKeys.projectSearch.index(projectId, cursor, limit),
    // Paging keeps the current page on screen until the next one arrives.
    placeholderData: keepPreviousData,
    queryFn: async () =>
      searchIndexDiagnosticsResultSchema.parse(
        await getData(
          await api.app.projects[':projectId'].settings.search.diagnostics.$get({
            param: { projectId },
            query: { limit: String(limit), ...(cursor ? { cursor } : {}) },
          }),
          'search index diagnostics',
        ),
      ),
  });

export const useProjectSearchConfiguration = (projectId: string) => useQuery(projectSearchConfigurationQueryOptions(projectId));

export const useUpdateProjectSearchConfiguration = (projectId: string) => {
  const queryClient = useQueryClient();
  const t = useT();
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
      // The published reader's shell carries the search settings; its search
      // results follow the result limit and version filter.
      queryClient.invalidateQueries({ queryKey: queryKeys.site.shell(projectId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.site.allSearch(projectId) });
    },
    meta: { errorMessage: (error) => friendlyErrorMessage(t, error, 'settings.saveError') },
  });
};

export const useProjectSearchIndexDiagnostics = (projectId: string, cursor?: string, limit = SEARCH_INDEX_SAMPLE_LIMIT) =>
  useQuery({
    ...projectSearchIndexDiagnosticsQueryOptions(projectId, cursor, limit),
    refetchInterval: (query) => {
      const data = query.state.data;
      // The first run can be active before its collection/alias is available.
      return data?.health === 'indexing' || data?.latestRun?.status === 'PENDING' || data?.latestRun?.status === 'RUNNING' ? 2000 : false;
    },
  });

/** Callers report a failure themselves (an inline error or their own toast). */
export const useCreateProjectSearchReindex = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      mutateData(await api.app.projects[':projectId'].settings.search.reindex.$post({ param: { projectId } }), 'Could not queue search indexing.'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.projectSearch.allIndex(projectId) }),
  });
};
