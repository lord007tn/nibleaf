import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { InsightsFilterBar } from '@/components/analytics/insights/filter-bar';
import { validateInsightsSearch } from '@/components/analytics/insights/filters';
import { InsightsSectionNav } from '@/components/analytics/insights/section-nav';
import { useInsightsFilters } from '@/components/analytics/insights/use-insights-filters';

export const Route = createFileRoute('/app/projects/$projectId/analytics')({
  component: ProjectAnalyticsLayout,
  // Filters live in the URL so a view is shareable and back/forward walk through changes.
  validateSearch: validateInsightsSearch,
});

/** The docs-owner analytics area: shared filters + section tabs; each section is a child route. */
function ProjectAnalyticsLayout() {
  const t = useT();
  const { projectId, filters, setFilters, timezone } = useInsightsFilters();
  return (
    // `contain: inline-size` keeps wide tables from widening the dashboard shell's
    // flex column: they scroll inside their own card instead of the page.
    <div className="w-full min-w-0 px-4 py-6 [contain:inline-size] sm:px-6 sm:py-8 xl:px-10">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t('analytics.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('analytics.insights.subtitle')}</p>
        </div>
        <InsightsFilterBar filters={filters} onChange={setFilters} timezone={timezone} />
        <InsightsSectionNav filters={filters} projectId={projectId} />
      </div>
      <div className="mt-6">
        <Outlet />
      </div>
    </div>
  );
}
