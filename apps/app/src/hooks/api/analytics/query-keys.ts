import type { AnalyticsInsightsQuery, AnalyticsRange } from '@nibleaf/validators';

type InsightsEndpoint = 'overview' | 'pages' | 'page' | 'search' | 'feedback' | 'ai' | 'performance';

export const analyticsQueryKeys = {
  project: (projectId: string, range: AnalyticsRange, timezone: string) => ['analytics', 'project', projectId, range, timezone] as const,
  workspace: (range: AnalyticsRange, timezone: string) => ['analytics', 'workspace', range, timezone] as const,
  /** Prefix of every insights query for one project (all endpoints and filters), for invalidation. */
  insightsForProject: (projectId: string) => ['analytics', 'insights', projectId] as const,
  /** Every filter value is part of the key, so a range/compare/timezone change is a new cache entry. */
  insights: (projectId: string, endpoint: InsightsEndpoint, query: AnalyticsInsightsQuery, path?: string) =>
    [
      'analytics',
      'insights',
      projectId,
      endpoint,
      query.range,
      query.from ?? '',
      query.to ?? '',
      query.compare,
      query.timezone,
      ...(path === undefined ? [] : [path]),
    ] as const,
};
