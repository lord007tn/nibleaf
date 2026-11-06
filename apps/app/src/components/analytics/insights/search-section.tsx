import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { useT } from '@nibleaf/i18n/react';
import { ArrowRight, Search } from 'lucide-react';
import { type SearchInsights, type SearchTermRow, useSearchInsights } from '@/hooks/api/analytics';
import { SimpleTable } from './data-table';
import type { InsightsSearch } from './filters';
import { InsightCard, PathText } from './insight-card';
import { insightsState, mergeSeries } from './insights-data';
import { InsightsEmpty, InsightsStatus } from './insights-status';
import { KpiCard } from './kpi-card';
import { TermsVisibilityNotice, TermText, WriteArticleButton } from './search-terms';
import { PageInsightsLink } from './section-links';
import { TrendChart } from './trend-chart';
import { useInsightFormat } from './use-insight-format';
import { useInsightsFilters } from './use-insights-filters';

export function SearchSection() {
  const { projectId, filters, query } = useInsightsFilters();
  const result = useSearchInsights(projectId, query);
  return <SearchView data={result.data} filters={filters} projectId={projectId} state={insightsState(result)} />;
}

function SearchView({
  data,
  state,
  projectId,
  filters,
}: {
  data: SearchInsights | undefined;
  state: ReturnType<typeof insightsState>;
  projectId: string;
  filters: InsightsSearch;
}) {
  const t = useT();
  const format = useInsightFormat();
  const { loading, unknown } = state;
  const kpis = data?.kpis;
  if (state.availability === 'not_configured') return <InsightsStatus projectId={projectId} state={state} />;
  const noSearches = data !== undefined && !unknown && data.kpis.searches.value === 0;
  const termsHidden = data !== undefined && !unknown && data.searchTermsVisibility !== 'visible';
  const granularity = data?.meta.granularity ?? 'day';

  const termColumns = [
    { key: 'term', header: t('analytics.search.column.term'), cell: (row: SearchTermRow) => <TermText term={row} /> },
    { key: 'searches', header: t('analytics.search.column.searches'), cell: (row: SearchTermRow) => format.count(row.searches), numeric: true },
    { key: 'ctr', header: t('analytics.search.column.ctr'), cell: (row: SearchTermRow) => format.rate(row.clickThroughRate), numeric: true },
    {
      key: 'top',
      header: t('analytics.search.column.topResult'),
      cell: (row: SearchTermRow) =>
        row.topResultPath ? (
          <PageInsightsLink filters={filters} path={row.topResultPath} projectId={projectId}>
            <PathText path={row.topResultPath} />
          </PageInsightsLink>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <InsightsStatus projectId={projectId} state={state} />
      {noSearches ? (
        <InsightsEmpty
          body={t('analytics.search.empty.body')}
          icon={<Search aria-hidden className="size-5" />}
          title={t('analytics.search.empty.title')}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              compared={kpis?.searches}
              hint={t('analytics.metric.searches.hint')}
              kind="count"
              label={t('analytics.metric.searches')}
              loading={loading}
              polarity="neutral"
            />
            <KpiCard
              compared={kpis?.zeroResultRate}
              hint={t('analytics.metric.zeroResultRate.hint')}
              kind="rate"
              label={t('analytics.metric.zeroResultRate')}
              loading={loading}
              polarity="lower_is_better"
            />
            <KpiCard
              compared={kpis?.clickThroughRate}
              hint={t('analytics.metric.ctr.hint')}
              kind="rate"
              label={t('analytics.metric.ctr')}
              loading={loading}
              polarity="higher_is_better"
            />
            <KpiCard
              compared={kpis?.refinementRate}
              hint={t('analytics.metric.refinementRate.hint')}
              kind="rate"
              label={t('analytics.metric.refinementRate')}
              loading={loading}
              polarity="lower_is_better"
            />
            <KpiCard
              compared={kpis?.averageClickPosition}
              hint={t('analytics.metric.clickPosition.hint')}
              kind="position"
              label={t('analytics.metric.clickPosition')}
              loading={loading}
              polarity="lower_is_better"
            />
            <KpiCard
              compared={kpis?.searchVisits}
              hint={t('analytics.metric.searchVisits.hint')}
              kind="count"
              label={t('analytics.metric.searchVisits')}
              loading={loading}
              polarity="neutral"
            />
          </div>

          <InsightCard description={t('analytics.search.trend.description')} title={t('analytics.search.trend.title')}>
            <TrendChart
              empty={t('analytics.empty.searches')}
              granularity={granularity}
              loading={loading}
              rows={mergeSeries([
                { key: 'searches', points: data?.searchesSeries ?? [] },
                { key: 'zero', points: data?.zeroResultSeries ?? [] },
              ])}
              series={[
                { key: 'searches', label: t('analytics.metric.searches'), color: 'var(--chart-1)' },
                { key: 'zero', label: t('analytics.search.zeroResults'), color: 'var(--destructive)' },
              ]}
              summary={t('analytics.search.trend.summary', {
                searches: format.count(kpis?.searches.value ?? null),
                rate: format.rate(kpis?.zeroResultRate.value ?? null),
              })}
              unknown={unknown}
            />
          </InsightCard>

          {termsHidden && data && data.searchTermsVisibility !== 'visible' ? (
            <TermsVisibilityNotice projectId={projectId} threshold={data.termVisibilityThreshold} visibility={data.searchTermsVisibility} />
          ) : null}

          <InsightCard description={t('analytics.search.failed.description')} title={t('analytics.search.failed.title')}>
            <SimpleTable
              caption={t('analytics.search.failed.title')}
              columns={[
                { key: 'term', header: t('analytics.search.column.term'), cell: (row: SearchTermRow) => <TermText term={row} /> },
                {
                  key: 'why',
                  header: t('analytics.search.column.problem'),
                  cell: (row: SearchTermRow) => (
                    <Badge variant={row.zeroResultSearches > 0 ? 'destructive' : 'outline'}>
                      {row.zeroResultSearches > 0 ? t('analytics.search.noResultsBadge') : t('analytics.search.noClicksBadge')}
                    </Badge>
                  ),
                },
                {
                  key: 'searches',
                  header: t('analytics.search.column.searches'),
                  cell: (row: SearchTermRow) => format.count(row.searches),
                  numeric: true,
                },
                { key: 'visits', header: t('analytics.search.column.visits'), cell: (row: SearchTermRow) => format.count(row.visits), numeric: true },
                {
                  key: 'action',
                  header: <span className="sr-only">{t('analytics.search.column.action')}</span>,
                  cell: (row: SearchTermRow) => (row.term ? <WriteArticleButton projectId={projectId} term={row.term} /> : null),
                  className: 'text-end',
                },
              ]}
              empty={t('analytics.search.failed.empty')}
              loading={loading}
              rowKey={(row) => row.termId}
              rows={data?.failedTerms ?? []}
              unknown={unknown}
            />
          </InsightCard>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <InsightCard description={t('analytics.search.top.description')} title={t('analytics.search.top.title')}>
              <SimpleTable
                caption={t('analytics.search.top.title')}
                columns={termColumns}
                empty={t('analytics.empty.searches')}
                loading={loading}
                rowKey={(row) => row.termId}
                rows={data?.topTerms ?? []}
                unknown={unknown}
              />
            </InsightCard>
            <InsightCard description={t('analytics.search.refinements.description')} title={t('analytics.search.refinements.title')}>
              {termsHidden ? (
                <p className="py-6 text-center text-muted-foreground text-sm">{t('analytics.search.refinements.hidden')}</p>
              ) : (
                <SimpleTable
                  caption={t('analytics.search.refinements.title')}
                  columns={[
                    {
                      key: 'pair',
                      header: t('analytics.search.column.refinement'),
                      cell: (row) => (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span dir="auto">{row.from}</span>
                          <ArrowRight
                            aria-label={t('analytics.search.refinements.then')}
                            className="size-3.5 text-muted-foreground rtl:-scale-x-100"
                          />
                          <span className="font-medium" dir="auto">
                            {row.to}
                          </span>
                        </span>
                      ),
                    },
                    { key: 'visits', header: t('analytics.search.column.visits'), cell: (row) => format.count(row.visits), numeric: true },
                  ]}
                  empty={t('analytics.search.refinements.empty')}
                  loading={loading}
                  rowKey={(row) => `${row.from}→${row.to}`}
                  rows={data?.refinements ?? []}
                  unknown={unknown}
                />
              )}
            </InsightCard>
          </div>

          {data && !unknown && data.hiddenTerms.terms > 0 ? (
            <p className="text-muted-foreground text-xs">
              {t('analytics.search.hiddenAggregate', {
                terms: format.count(data.hiddenTerms.terms),
                searches: format.count(data.hiddenTerms.searches),
                threshold: format.count(data.termVisibilityThreshold),
              })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
