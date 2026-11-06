import { useT } from '@nibleaf/i18n/react';
import type { AnalyticsRange } from '@nibleaf/validators';
import { useQuery } from '@tanstack/react-query';
import { analyticsTimezone, projectAnalyticsQueryOptions, workspaceAnalyticsQueryOptions } from './query-options';

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
