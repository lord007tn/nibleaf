import { createFileRoute } from '@tanstack/react-router';
import { insightsQueryForSearch, validateInsightsSearch } from '@/components/analytics/insights/filters';
import { PagesSection } from '@/components/analytics/insights/pages-section';
import { pageInsightsQueryOptions, pagesInsightsQueryOptions } from '@/hooks/api/analytics/insights';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';

export const Route = createFileRoute('/app/projects/$projectId/analytics/pages')({
  component: PagesRoute,
  // `?path=guide/install` opens that page's drill-down; without it the full table shows.
  validateSearch: (search: Record<string, unknown>): { path?: string } =>
    typeof search.path === 'string' && search.path.trim() ? { path: search.path.trim().slice(0, 512) } : {},
  // The URL filters (validated by the analytics layout) and the drill-down path decide the query.
  loaderDeps: ({ search }) => ({ filters: validateInsightsSearch(search as Record<string, unknown>), path: search.path }),
  loader: ({ context: { queryClient }, params: { projectId }, deps: { filters, path } }) => {
    const query = insightsQueryForSearch(filters as Record<string, unknown>);
    if (path) prefetchRouteData(queryClient, pageInsightsQueryOptions(projectId, query, path));
    else prefetchRouteData(queryClient, pagesInsightsQueryOptions(projectId, query));
  },
});

function PagesRoute() {
  const { path } = Route.useSearch();
  return <PagesSection path={path} />;
}
