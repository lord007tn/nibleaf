import type { AnalyticsRange } from '@nibleaf/validators';
import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from '../client-helpers';
import { analyticsQueryKeys } from './query-keys';

const browserTimezoneFn = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Module-private until the project home and workspace routes prefetch them in a loader.
const projectAnalyticsQueryOptions = (projectId: string | undefined, range: AnalyticsRange, timezone: string) =>
  queryOptions({
    queryKey: analyticsQueryKeys.project(projectId ?? '', range, timezone),
    queryFn: projectId
      ? async () => getData(await api.app.projects[':projectId'].analytics.$get({ param: { projectId }, query: { range, timezone } }), 'analytics')
      : skipToken,
  });

const workspaceAnalyticsQueryOptions = (range: AnalyticsRange, timezone: string) =>
  queryOptions({
    queryKey: analyticsQueryKeys.workspace(range, timezone),
    queryFn: async () => getData(await api.app.workspace.analytics.$get({ query: { range, timezone } }), 'workspace analytics'),
  });

export const useProjectAnalytics = (projectId: string | undefined, range: AnalyticsRange, options?: { enabled?: boolean; timezone?: string }) =>
  useQuery({ ...projectAnalyticsQueryOptions(projectId, range, options?.timezone ?? browserTimezoneFn()), enabled: options?.enabled ?? true });

export const useWorkspaceAnalytics = (range: AnalyticsRange, options?: { enabled?: boolean; timezone?: string }) =>
  useQuery({ ...workspaceAnalyticsQueryOptions(range, options?.timezone ?? browserTimezoneFn()), enabled: options?.enabled ?? true });
