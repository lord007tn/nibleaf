import { createFileRoute, Outlet } from '@tanstack/react-router';
import { AnalyticsLayout } from '@/components/analytics/insights/analytics-layout';
import { validateInsightsSearch } from '@/components/analytics/insights/filters';
import { useInsightsFilters } from '@/components/analytics/insights/use-insights-filters';

export const Route = createFileRoute('/app/projects/$projectId/analytics')({
  component: ProjectAnalyticsLayout,
  // Filters live in the URL so a view is shareable and back/forward walk through changes.
  validateSearch: validateInsightsSearch,
});

/** The docs-owner analytics area: shared filters + section tabs; each section is a child route. */
function ProjectAnalyticsLayout() {
  const { projectId, filters, setFilters, timezone } = useInsightsFilters();
  return (
    <AnalyticsLayout filters={filters} onFiltersChange={setFilters} projectId={projectId} timezone={timezone}>
      <Outlet />
    </AnalyticsLayout>
  );
}
