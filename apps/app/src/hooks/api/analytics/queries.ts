import type { InferResponseType } from '@nibleaf/server/rpc';
import type { AnalyticsRange } from '@nibleaf/validators';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from '../client-helpers';
import { analyticsQueryKeys } from './query-keys';

type ProjectAnalyticsEndpoint = (typeof api.app.projects)[':projectId']['analytics']['$get'];
type WorkspaceAnalyticsEndpoint = typeof api.app.workspace.analytics.$get;

export type ProjectAnalytics = InferResponseType<ProjectAnalyticsEndpoint, 200>['data'];
export type WorkspaceAnalytics = InferResponseType<WorkspaceAnalyticsEndpoint, 200>['data'];

const browserTimezoneFn = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export const useProjectAnalytics = (projectId: string | undefined, range: AnalyticsRange, options?: { enabled?: boolean; timezone?: string }) => {
  const timezone = options?.timezone ?? browserTimezoneFn();
  return useQuery({
    queryKey: analyticsQueryKeys.project(projectId ?? '', range, timezone),
    enabled: Boolean(projectId) && (options?.enabled ?? true),
    queryFn: async () =>
      getData<ProjectAnalytics>(
        await api.app.projects[':projectId'].analytics.$get({
          param: { projectId: projectId as string },
          query: { range, timezone },
        }),
        'analytics',
      ),
  });
};

export const useWorkspaceAnalytics = (range: AnalyticsRange, options?: { enabled?: boolean; timezone?: string }) => {
  const timezone = options?.timezone ?? browserTimezoneFn();
  return useQuery({
    queryKey: analyticsQueryKeys.workspace(range, timezone),
    enabled: options?.enabled ?? true,
    queryFn: async () => getData<WorkspaceAnalytics>(await api.app.workspace.analytics.$get({ query: { range, timezone } }), 'workspace analytics'),
  });
};
