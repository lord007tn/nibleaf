import { useT } from '@nibleaf/i18n/react';
import { ThumbsUp } from 'lucide-react';
import { type FeedbackInsights, useFeedbackInsights } from '@/hooks/api/analytics';
import { SimpleTable } from './data-table';
import type { InsightsSearch } from './filters';
import { InsightCard, PageLabel } from './insight-card';
import { insightsState, mergeSeries, sortWorstFirst } from './insights-data';
import { InsightsEmpty, InsightsRegion, type InsightsRetry, InsightsStatus, insightsRetry } from './insights-status';
import { KpiCard, KpiGrid } from './kpi-card';
import { PageInsightsLink } from './section-links';
import { TrendChart } from './trend-chart';
import { useInsightFormat } from './use-insight-format';
import { useInsightsFilters } from './use-insights-filters';

type FeedbackPage = FeedbackInsights['pages'][number];

export function FeedbackSection() {
  const { projectId, filters, query } = useInsightsFilters();
  const result = useFeedbackInsights(projectId, query);
  return <FeedbackView data={result.data} retry={insightsRetry(result)} filters={filters} projectId={projectId} state={insightsState(result)} />;
}

function FeedbackView({
  data,
  state,
  retry,
  projectId,
  filters,
}: {
  data: FeedbackInsights | undefined;
  state: ReturnType<typeof insightsState>;
  retry: InsightsRetry;
  projectId: string;
  filters: InsightsSearch;
}) {
  const t = useT();
  const format = useInsightFormat();
  const { loading, unknown } = state;
  const kpis = data?.kpis;
  if (state.availability === 'not_configured' || state.availability === 'reads_disabled')
    return <InsightsStatus projectId={projectId} retry={retry} state={state} />;
  const noVotes = data !== undefined && !unknown && data.kpis.helpful.value === 0 && data.kpis.notHelpful.value === 0;
  return (
    <InsightsRegion loading={loading}>
      <InsightsStatus projectId={projectId} retry={retry} state={state} />
      {noVotes ? (
        <InsightsEmpty
          body={t('analytics.feedback.emptyBody')}
          icon={<ThumbsUp aria-hidden className="size-5" />}
          title={t('analytics.feedback.empty')}
        />
      ) : (
        <>
          <KpiGrid className="xl:grid-cols-4">
            <KpiCard
              compared={kpis?.helpfulRate}
              hint={t('analytics.metric.helpfulRate.hint')}
              kind="rate"
              label={t('analytics.metric.helpfulRate')}
              loading={loading}
              polarity="higher_is_better"
            />
            <KpiCard
              compared={kpis?.helpful}
              hint={t('analytics.metric.helpfulVotes.hint')}
              kind="count"
              label={t('analytics.feedback.helpful')}
              loading={loading}
              polarity="higher_is_better"
            />
            <KpiCard
              compared={kpis?.notHelpful}
              hint={t('analytics.metric.notHelpfulVotes.hint')}
              kind="count"
              label={t('analytics.feedback.notHelpful')}
              loading={loading}
              polarity="lower_is_better"
            />
            <KpiCard
              compared={kpis?.responseRate}
              hint={t('analytics.metric.responseRate.hint')}
              kind="rate"
              label={t('analytics.metric.responseRate')}
              loading={loading}
              polarity="higher_is_better"
            />
          </KpiGrid>

          <InsightCard description={t('analytics.feedback.trend.description')} title={t('analytics.feedback.trend.title')}>
            <TrendChart
              empty={t('analytics.feedback.empty')}
              granularity={data?.meta.granularity ?? 'day'}
              loading={loading}
              rows={mergeSeries([
                { key: 'helpful', points: (data?.series ?? []).map((point) => ({ bucket: point.bucket, value: point.helpful })) },
                { key: 'notHelpful', points: (data?.series ?? []).map((point) => ({ bucket: point.bucket, value: point.notHelpful })) },
              ])}
              series={[
                { key: 'helpful', label: t('analytics.feedback.helpful'), color: 'var(--success)' },
                { key: 'notHelpful', label: t('analytics.feedback.notHelpful'), color: 'var(--destructive)' },
              ]}
              summary={t('analytics.feedback.chartSummary', {
                helpful: format.count(kpis?.helpful.value ?? null),
                notHelpful: format.count(kpis?.notHelpful.value ?? null),
              })}
              unknown={unknown}
            />
          </InsightCard>

          <InsightCard description={t('analytics.feedback.pages.description')} title={t('analytics.feedback.pages.title')}>
            <SimpleTable
              caption={t('analytics.feedback.pages.title')}
              columns={[
                {
                  key: 'page',
                  header: t('analytics.pages.column.page'),
                  cell: (row: FeedbackPage) => (
                    <PageInsightsLink className="block max-w-[18rem]" filters={filters} path={row.path} projectId={projectId}>
                      <PageLabel path={row.path} title={row.title} />
                    </PageInsightsLink>
                  ),
                },
                {
                  key: 'rate',
                  header: t('analytics.pages.column.helpful'),
                  cell: (row: FeedbackPage) => format.rate(row.helpfulRate),
                  numeric: true,
                },
                { key: 'helpful', header: t('analytics.feedback.helpful'), cell: (row: FeedbackPage) => format.count(row.helpful), numeric: true },
                {
                  key: 'notHelpful',
                  header: t('analytics.feedback.notHelpful'),
                  cell: (row: FeedbackPage) => format.count(row.notHelpful),
                  numeric: true,
                },
                { key: 'views', header: t('analytics.pages.column.views'), cell: (row: FeedbackPage) => format.count(row.views), numeric: true },
              ]}
              empty={t('analytics.feedback.empty')}
              loading={loading}
              rowKey={(row) => row.path}
              rows={sortWorstFirst(data?.pages ?? [])}
              unknown={unknown}
            />
          </InsightCard>
        </>
      )}
    </InsightsRegion>
  );
}
