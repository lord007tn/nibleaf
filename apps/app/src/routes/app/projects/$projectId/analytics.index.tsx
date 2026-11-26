import { createFileRoute } from '@tanstack/react-router';
import { validateInsightsSearch } from '@/components/analytics/insights/filters';
import { OverviewSection } from '@/components/analytics/insights/overview-section';
import { insightsQueryForSearch } from '@/components/analytics/insights/query';
import { overviewInsightsQueryOptions } from '@/hooks/api/analytics/insights';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';

export const Route = createFileRoute('/app/projects/$projectId/analytics/')({
  // The URL filters (validated by the analytics layout) decide the query, so the loader re-runs when they change.
  loaderDeps: ({ search }) => validateInsightsSearch(search as Record<string, unknown>),
  loader: ({ context: { queryClient }, params: { projectId }, deps }) =>
    prefetchRouteData(queryClient, overviewInsightsQueryOptions(projectId, insightsQueryForSearch(deps as Record<string, unknown>))),
  component: OverviewSection,
});
