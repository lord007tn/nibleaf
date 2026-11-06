import { useT } from '@nibleaf/i18n/react';
import { usePagesInsights } from '@/hooks/api/analytics';
import { InsightCard } from './insight-card';
import { dataFreshness, insightsState } from './insights-data';
import { InsightsEmpty, InsightsRegion, InsightsStatus, insightsRetry } from './insights-status';
import { PageDetailSection } from './page-detail-section';
import { PagesTable } from './pages-table';
import { useInsightsFilters } from './use-insights-filters';

/** The Pages section: the full table, or one page's drill-down when `?path=` is set. */
export function PagesSection({ path }: { path?: string }) {
  if (path) return <PageDetailSection path={path} />;
  return <PagesOverview />;
}

function PagesOverview() {
  const t = useT();
  const { projectId, filters, query } = useInsightsFilters();
  const result = usePagesInsights(projectId, query);
  const state = insightsState(result);
  const data = result.data;
  if (state.availability === 'not_configured') return <InsightsStatus projectId={projectId} state={state} />;
  const noRows = data !== undefined && !state.unknown && data.rows.length === 0;
  return (
    <InsightsRegion loading={state.loading}>
      <InsightsStatus projectId={projectId} retry={insightsRetry(result)} state={state} />
      {noRows ? (
        dataFreshness(state.lastEventAt) === 'fresh' || dataFreshness(state.lastEventAt) === 'stale' ? (
          <InsightsEmpty body={t('analytics.empty.noVisitsInPeriod.body')} title={t('analytics.empty.noVisitsInPeriod.title')} />
        ) : (
          <InsightsEmpty body={t('analytics.empty.noVisits.body')} title={t('analytics.empty.noVisits.title')} />
        )
      ) : (
        <InsightCard
          description={data?.truncated ? t('analytics.pages.truncated') : t('analytics.pages.description')}
          title={t('analytics.pages.title')}
        >
          {state.unknown ? (
            <p className="py-6 text-center text-muted-foreground text-sm">{t('analytics.state.unknown')}</p>
          ) : (
            <PagesTable
              compare={Boolean(data?.meta.previous)}
              filters={filters}
              loading={state.loading}
              projectId={projectId}
              rows={data?.rows ?? []}
            />
          )}
        </InsightCard>
      )}
    </InsightsRegion>
  );
}
