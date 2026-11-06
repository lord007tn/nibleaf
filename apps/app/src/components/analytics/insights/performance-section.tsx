import { useT } from '@nibleaf/i18n/react';
import { Gauge } from 'lucide-react';
import { type PerformanceInsights, usePerformanceInsights } from '@/hooks/api/analytics';
import { SimpleTable } from './data-table';
import type { InsightsSearch } from './filters';
import { InsightCard, PageLabel } from './insight-card';
import { insightsState, mergeSeries } from './insights-data';
import { InsightsEmpty, InsightsRegion, type InsightsRetry, InsightsStatus, insightsRetry } from './insights-status';
import { deviceLabelKey } from './labels';
import { PageInsightsLink } from './section-links';
import { TrendChart } from './trend-chart';
import { useInsightFormat } from './use-insight-format';
import { useInsightsFilters } from './use-insights-filters';
import { RatingBadge, RatingDistribution, VitalsCards } from './vitals';
import { rateVital } from './web-vitals';

type DeviceRow = PerformanceInsights['byDevice'][number];
type SlowPage = PerformanceInsights['slowestPages'][number];

export function PerformanceSection() {
  const { projectId, filters, query } = useInsightsFilters();
  const result = usePerformanceInsights(projectId, query);
  return <PerformanceView data={result.data} retry={insightsRetry(result)} filters={filters} projectId={projectId} state={insightsState(result)} />;
}

function PerformanceView({
  data,
  state,
  retry,
  projectId,
  filters,
}: {
  data: PerformanceInsights | undefined;
  state: ReturnType<typeof insightsState>;
  retry: InsightsRetry;
  projectId: string;
  filters: InsightsSearch;
}) {
  const t = useT();
  const format = useInsightFormat();
  const { loading, unknown } = state;
  if (state.availability === 'not_configured') return <InsightsStatus projectId={projectId} retry={retry} state={state} />;
  const noSamples = data !== undefined && !unknown && data.overall.samples === 0;
  const vitalCell = (metric: 'lcp' | 'inp' | 'cls', value: number | null) => (
    <span className="inline-flex items-center justify-end gap-2">
      {metric === 'cls' ? format.decimal(value) : format.ms(value)}
      {value === null ? null : <RatingBadge rating={rateVital(metric, value)} />}
    </span>
  );

  return (
    <InsightsRegion loading={loading}>
      <InsightsStatus projectId={projectId} retry={retry} state={state} />
      {noSamples ? (
        <InsightsEmpty
          body={t('analytics.perf.empty.body')}
          icon={<Gauge aria-hidden className="size-5" />}
          title={t('analytics.perf.empty.title')}
        />
      ) : (
        <>
          <InsightCard description={t('analytics.perf.description')} title={t('analytics.perf.title')}>
            <div className="flex flex-col gap-5">
              <VitalsCards loading={loading} summary={data?.overall} unknown={unknown} />
              {loading || unknown ? null : (
                <div className="flex flex-col gap-2">
                  <p className="font-medium text-sm">{t('analytics.perf.distribution')}</p>
                  <RatingDistribution rating={data?.overall.rating ?? null} />
                  <p className="text-muted-foreground text-xs">
                    {t('analytics.perf.samples', { count: format.count(data?.overall.samples ?? null) })} ·{' '}
                    {t('analytics.perf.secondary', {
                      fcp: format.ms(data?.overall.fcpP75Ms ?? null),
                      ttfb: format.ms(data?.overall.ttfbP75Ms ?? null),
                    })}
                  </p>
                </div>
              )}
            </div>
          </InsightCard>

          <InsightCard description={t('analytics.perf.trend.description')} title={t('analytics.perf.trend.title')}>
            <TrendChart
              empty={t('analytics.vitals.noSamples')}
              granularity={data?.meta.granularity ?? 'day'}
              loading={loading}
              rows={mergeSeries([{ key: 'lcp', points: data?.lcpP75Series ?? [] }])}
              series={[{ key: 'lcp', label: t('analytics.vitals.lcp'), color: 'var(--chart-1)' }]}
              summary={t('analytics.perf.trend.summary', { value: format.ms(data?.overall.lcpP75Ms ?? null) })}
              unknown={unknown}
              valueKind="ms"
            />
          </InsightCard>

          <InsightCard description={t('analytics.perf.devices.description')} title={t('analytics.perf.devices.title')}>
            <SimpleTable
              caption={t('analytics.perf.devices.title')}
              columns={[
                {
                  key: 'device',
                  header: t('analytics.perf.column.device'),
                  cell: (row: DeviceRow) => {
                    const key = deviceLabelKey(row.device);
                    return key ? t(key) : row.device;
                  },
                },
                { key: 'lcp', header: t('analytics.vitals.lcp.short'), cell: (row: DeviceRow) => vitalCell('lcp', row.lcpP75Ms), numeric: true },
                { key: 'inp', header: t('analytics.vitals.inp.short'), cell: (row: DeviceRow) => vitalCell('inp', row.inpP75Ms), numeric: true },
                { key: 'cls', header: t('analytics.vitals.cls.short'), cell: (row: DeviceRow) => vitalCell('cls', row.clsP75), numeric: true },
                { key: 'samples', header: t('analytics.perf.column.samples'), cell: (row: DeviceRow) => format.count(row.samples), numeric: true },
              ]}
              empty={t('analytics.vitals.noSamples')}
              loading={loading}
              rowKey={(row) => row.device}
              rows={data?.byDevice ?? []}
              unknown={unknown}
            />
          </InsightCard>

          <InsightCard description={t('analytics.perf.slowest.description')} title={t('analytics.perf.slowest.title')}>
            <SimpleTable
              caption={t('analytics.perf.slowest.title')}
              columns={[
                {
                  key: 'page',
                  header: t('analytics.pages.column.page'),
                  cell: (row: SlowPage) => (
                    <PageInsightsLink className="block max-w-[18rem]" filters={filters} path={row.path} projectId={projectId}>
                      <PageLabel path={row.path} title={row.title} />
                    </PageInsightsLink>
                  ),
                },
                { key: 'lcp', header: t('analytics.vitals.lcp.short'), cell: (row: SlowPage) => vitalCell('lcp', row.lcpP75Ms), numeric: true },
                { key: 'inp', header: t('analytics.vitals.inp.short'), cell: (row: SlowPage) => vitalCell('inp', row.inpP75Ms), numeric: true },
                { key: 'cls', header: t('analytics.vitals.cls.short'), cell: (row: SlowPage) => vitalCell('cls', row.clsP75), numeric: true },
                { key: 'samples', header: t('analytics.perf.column.samples'), cell: (row: SlowPage) => format.count(row.samples), numeric: true },
              ]}
              empty={t('analytics.perf.slowest.empty')}
              loading={loading}
              rowKey={(row) => row.path}
              rows={data?.slowestPages ?? []}
              unknown={unknown}
            />
          </InsightCard>
        </>
      )}
    </InsightsRegion>
  );
}
