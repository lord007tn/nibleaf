import { createFileRoute } from '@tanstack/react-router';
import { insightsQueryForSearch, validateInsightsSearch } from '@/components/analytics/insights/filters';
import { PerformanceSection } from '@/components/analytics/insights/performance-section';
import { performanceInsightsQueryOptions } from '@/hooks/api/analytics/insights';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';

export const Route = createFileRoute('/app/projects/$projectId/analytics/performance')({
  // The URL filters (validated by the analytics layout) decide the query, so the loader re-runs when they change.
  loaderDeps: ({ search }) => validateInsightsSearch(search as Record<string, unknown>),
  loader: ({ context: { queryClient }, params: { projectId }, deps }) =>
    prefetchRouteData(queryClient, performanceInsightsQueryOptions(projectId, insightsQueryForSearch(deps as Record<string, unknown>))),
  component: PerformanceSection,
});
