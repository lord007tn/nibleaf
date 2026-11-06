import type { AnalyticsRange } from '@nibleaf/validators';
import { queryOptions, skipToken } from '@tanstack/react-query';
import { api } from '@/services/api';
import { getData } from '../client-helpers';
import { queryKeys } from '../query-keys';

/*
 * Factories for the site and workspace analytics summaries (apps/app/DATA_LOADING.md).
 * Route loaders import this module directly: loaders are not code-split, so whatever
 * they import ships in every page's first load, the public reader's included. Keep it
 * light (no i18n or components); the hooks that translate live in ./queries.
 */

/** The timezone analytics are bucketed in: the browser's. Loaders and screens
 *  must use the same value so a prefetch lands in the entry the screen reads. */
export const analyticsTimezone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Site page views and trend for the project home. */
export const projectAnalyticsQueryOptions = (projectId: string | undefined, range: AnalyticsRange, timezone: string) =>
  queryOptions({
    queryKey: queryKeys.analytics.project(projectId ?? '', range, timezone),
    queryFn: projectId
      ? async () => getData(await api.app.projects[':projectId'].analytics.$get({ param: { projectId }, query: { range, timezone } }), 'analytics')
      : skipToken,
  });

/** Every site the person can reach, for the workspace home and workspace analytics. */
export const workspaceAnalyticsQueryOptions = (range: AnalyticsRange, timezone: string) =>
  queryOptions({
    queryKey: queryKeys.analytics.workspace(range, timezone),
    queryFn: async () => getData(await api.app.workspace.analytics.$get({ query: { range, timezone } }), 'workspace analytics'),
  });
