import { useT } from '@nibleaf/i18n/react';
import type { AnalyticsRange } from '@nibleaf/validators';
import { queryOptions, skipToken, useQuery } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from '../client-helpers';
import { queryKeys } from '../query-keys';

/** The timezone analytics are bucketed in: the browser's. Loaders and screens
 *  must use the same value so a prefetch lands in the entry the screen reads. */
export const analyticsTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Site page views and trend for the project home. Loader-safe (no i18n). */
export const projectAnalyticsQueryOptions = (projectId: string | undefined, range: AnalyticsRange, timezone: string) =>
  queryOptions({
    queryKey: queryKeys.analytics.project(projectId ?? '', range, timezone),
    queryFn: projectId
      ? async () => getData(await api.app.projects[':projectId'].analytics.$get({ param: { projectId }, query: { range, timezone } }), 'analytics')
      : skipToken,
  });

/** Every site the person can reach, for the workspace home and workspace analytics. Loader-safe (no i18n). */
export const workspaceAnalyticsQueryOptions = (range: AnalyticsRange, timezone: string) =>
  queryOptions({
    queryKey: queryKeys.analytics.workspace(range, timezone),
    queryFn: async () => getData(await api.app.workspace.analytics.$get({ query: { range, timezone } }), 'workspace analytics'),
  });

/** The project home shows page views without an error state of its own, so a
 *  failure is reported once, in plain language, by the shared query cache. */
export const useProjectAnalytics = (projectId: string | undefined, range: AnalyticsRange, options?: { enabled?: boolean; timezone?: string }) => {
  const t = useT();
  return useQuery({
    ...projectAnalyticsQueryOptions(projectId, range, options?.timezone ?? analyticsTimezone()),
    enabled: options?.enabled ?? true,
    meta: { errorMessage: t('analytics.projectSummary.loadFailed') },
  });
};

/** Its screens (workspace home, workspace analytics) show their own unavailable
 *  state with a retry, so no toast. */
export const useWorkspaceAnalytics = (range: AnalyticsRange, options?: { enabled?: boolean; timezone?: string }) =>
  useQuery({ ...workspaceAnalyticsQueryOptions(range, options?.timezone ?? analyticsTimezone()), enabled: options?.enabled ?? true });
