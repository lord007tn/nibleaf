import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useLocale } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, ExternalLink, PenLine } from 'lucide-react';
import { type PageDetailInsights, usePageInsights } from '@/hooks/api/analytics';
import { SimpleTable } from './data-table';
import { filterSearch, type InsightsSearch } from './filters';
import { InsightCard, PageLabel, PathText, RankedList } from './insight-card';
import { alignWithPrevious, insightsState, mergeSeries } from './insights-data';
import { InsightsStatus } from './insights-status';
import { KpiCard, KpiGrid } from './kpi-card';
import { CHANNEL_LABELS, deviceLabelKey, languageName } from './labels';
import { FeedbackSplit } from './overview-section';
import { HiddenTermsEmpty, TermsEmptyState, TermText } from './search-terms';
import { PageInsightsLink } from './section-links';
import { TrendChart, useSeriesSummary } from './trend-chart';
import { useInsightFormat } from './use-insight-format';
import { useInsightsFilters } from './use-insights-filters';
import { usePageLinks } from './use-page-links';
import { VitalsCards } from './vitals';

/** One page's drill-down: traffic vs the previous period, reading behaviour, feedback, journeys, speed and AI crawlers. */
export function PageDetailSection({ path }: { path: string }) {
  const { projectId, filters, query } = useInsightsFilters();
  const result = usePageInsights(projectId, query, path);
  return <PageDetailView data={result.data} filters={filters} path={path} projectId={projectId} state={insightsState(result)} />;
}

function PageDetailView({
  data,
  state,
  projectId,
  filters,
  path,
}: {
  data: PageDetailInsights | undefined;
  state: ReturnType<typeof insightsState>;
  projectId: string;
  filters: InsightsSearch;
  path: string;
}) {
  const { t, locale } = useLocale();
  const format = useInsightFormat();
  const summarize = useSeriesSummary();
  const links = usePageLinks(projectId);
  const { loading, unknown } = state;
  const compare = Boolean(data?.meta.previous);
  const granularity = data?.meta.granularity ?? 'day';
  const editorPageId = links.editorPageId(path);
  const kpis = data?.kpis;
  const journey = (items: Array<{ path: string; clicks: number }> | undefined) =>
    (items ?? []).map((item) => ({
      key: item.path,
      label: (
        <PageInsightsLink filters={filters} path={item.path} projectId={projectId}>
          <PathText path={item.path} />
        </PageInsightsLink>
      ),
      value: item.clicks,
    }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Button
          className="-ms-2 w-fit"
          nativeButton={false}
          render={<Link params={{ projectId }} search={filterSearch(filters)} to="/app/projects/$projectId/analytics/pages" />}
          size="sm"
          variant="ghost"
        >
          <ArrowLeft aria-hidden className="rtl:-scale-x-100" />
          {t('analytics.page.back')}
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">{loading ? <Skeleton className="h-7 w-56" /> : <PageLabel path={path} title={data?.title ?? null} />}</div>
          <div className="flex flex-wrap gap-2">
            <Button nativeButton={false} render={<a href={links.liveHref(path)} rel="noreferrer" target="_blank" />} size="sm" variant="outline">
              <ExternalLink aria-hidden />
              {t('analytics.page.openLive')}
            </Button>
            {editorPageId ? (
              <Button
                nativeButton={false}
                render={<Link params={{ projectId }} search={{ page: editorPageId }} to="/app/projects/$projectId/editor" />}
                size="sm"
                variant="outline"
              >
                <PenLine aria-hidden />
                {t('analytics.page.edit')}
              </Button>
            ) : null}
          </div>
        </div>
      </div>

      <InsightsStatus projectId={projectId} state={state} />
      {state.availability === 'not_configured' ? null : (
        <>
          <KpiGrid className="xl:grid-cols-3">
            <KpiCard
              compared={kpis?.views}
              hint={t('analytics.metric.pageViews.hint')}
              kind="count"
              label={t('analytics.metric.pageViews')}
              loading={loading}
              polarity="higher_is_better"
            />
            <KpiCard
              compared={kpis?.visits}
              hint={t('analytics.metric.visits.consentHint')}
              kind="count"
              label={t('analytics.metric.visits')}
              loading={loading}
              polarity="higher_is_better"
            />
            <KpiCard
              compared={kpis?.avgEngagedMs}
              hint={t('analytics.metric.engagedTime.hint')}
              kind="duration"
              label={t('analytics.metric.engagedTime')}
              loading={loading}
              polarity="higher_is_better"
            />
            <KpiCard
              compared={kpis?.avgScrollDepth}
              hint={t('analytics.metric.scrollDepth.hint')}
              kind="rate"
              label={t('analytics.metric.scrollDepth')}
              loading={loading}
              polarity="higher_is_better"
            />
            <KpiCard
              compared={kpis?.exitRate}
              hint={t('analytics.metric.exitRate.hint')}
              kind="rate"
              label={t('analytics.metric.exitRate')}
              loading={loading}
              polarity="lower_is_better"
            />
            <KpiCard
              compared={kpis?.helpfulRate}
              hint={t('analytics.metric.helpfulRate.hint')}
              kind="rate"
              label={t('analytics.metric.helpfulRate')}
              loading={loading}
              polarity="higher_is_better"
            />
          </KpiGrid>

          <InsightCard description={t('analytics.page.trend.description')} title={t('analytics.page.trend.title')}>
            <TrendChart
              empty={t('analytics.empty.pageviews')}
              granularity={granularity}
              loading={loading}
              rows={alignWithPrevious(data?.viewsSeries ?? [], compare ? (data?.previousViewsSeries ?? []) : [])}
              series={[
                { key: 'current', label: t('analytics.metric.pageViews'), color: 'var(--chart-1)' },
                ...(compare ? [{ key: 'previous', label: t('analytics.chart.previousPeriod'), color: 'var(--muted-foreground)', dashed: true }] : []),
              ]}
              summary={summarize(t('analytics.metric.pageViews'), data?.viewsSeries ?? [], granularity)}
              unknown={unknown}
            />
          </InsightCard>

          <InsightCard description={t('analytics.page.feedback.description')} title={t('analytics.overview.feedback.title')}>
            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              {loading ? (
                <Skeleton className="h-24 w-full" />
              ) : unknown ? (
                <p className="text-muted-foreground text-sm">{t('analytics.state.unknown')}</p>
              ) : (data?.feedback.helpful ?? 0) + (data?.feedback.notHelpful ?? 0) === 0 ? (
                <p className="text-muted-foreground text-sm">{t('analytics.feedback.empty')}</p>
              ) : (
                <FeedbackSplit helpful={data?.feedback.helpful ?? 0} notHelpful={data?.feedback.notHelpful ?? 0} />
              )}
              <TrendChart
                empty={t('analytics.feedback.empty')}
                granularity={granularity}
                loading={loading}
                rows={mergeSeries([
                  { key: 'helpful', points: (data?.feedback.series ?? []).map((point) => ({ bucket: point.bucket, value: point.helpful })) },
                  { key: 'notHelpful', points: (data?.feedback.series ?? []).map((point) => ({ bucket: point.bucket, value: point.notHelpful })) },
                ])}
                series={[
                  { key: 'helpful', label: t('analytics.feedback.helpful'), color: 'var(--success)' },
                  { key: 'notHelpful', label: t('analytics.feedback.notHelpful'), color: 'var(--destructive)' },
                ]}
                summary={t('analytics.feedback.chartSummary', {
                  helpful: format.count(data?.feedback.helpful ?? null),
                  notHelpful: format.count(data?.feedback.notHelpful ?? null),
                })}
                unknown={unknown}
              />
            </div>
          </InsightCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InsightCard description={t('analytics.page.channels.description')} title={t('analytics.overview.channels.title')}>
              <RankedList
                empty={t('analytics.empty.pageviews')}
                items={(data?.channels ?? []).map((channel) => ({
                  key: channel.channel,
                  label: t(CHANNEL_LABELS[channel.channel]),
                  value: channel.visits,
                }))}
                loading={loading}
                unknown={unknown}
              />
            </InsightCard>
            <InsightCard description={t('analytics.page.referrers.description')} title={t('analytics.section.referrers')}>
              <RankedList
                empty={t('analytics.page.referrers.empty')}
                items={(data?.referrers ?? []).map((referrer) => ({
                  key: referrer.domain,
                  label: (
                    <span className="truncate" dir="ltr">
                      {referrer.domain}
                    </span>
                  ),
                  value: referrer.visits,
                }))}
                loading={loading}
                unknown={unknown}
              />
            </InsightCard>
            <InsightCard description={t('analytics.page.searches.description')} title={t('analytics.page.searches.title')}>
              <RankedList
                empty={
                  data && data.searchTermsVisibility !== 'visible' ? (
                    <HiddenTermsEmpty projectId={projectId} visibility={data.searchTermsVisibility} />
                  ) : (
                    <TermsEmptyState known={t('analytics.page.searches.empty')} reason={t('analytics.search.rareHidden')} />
                  )
                }
                items={(data?.searchesLeadingHere ?? []).map((term) => ({
                  key: term.termId,
                  label: <TermText term={term} />,
                  value: term.searches,
                }))}
                loading={loading}
                unknown={unknown}
              />
            </InsightCard>
            <InsightCard description={t('analytics.page.next.description')} title={t('analytics.page.next.title')}>
              <RankedList empty={t('analytics.page.journey.empty')} items={journey(data?.nextPages)} loading={loading} unknown={unknown} />
            </InsightCard>
            <InsightCard description={t('analytics.page.previous.description')} title={t('analytics.page.previous.title')}>
              <RankedList empty={t('analytics.page.journey.empty')} items={journey(data?.previousPages)} loading={loading} unknown={unknown} />
            </InsightCard>
            <InsightCard title={t('analytics.section.devices')}>
              <RankedList
                empty={t('analytics.empty.pageviews')}
                items={(data?.devices ?? []).map((device) => {
                  const key = deviceLabelKey(device.device);
                  return { key: device.device, label: key ? t(key) : device.device, value: device.views };
                })}
                loading={loading}
                unknown={unknown}
              />
            </InsightCard>
            <InsightCard title={t('analytics.section.languages')}>
              <RankedList
                empty={t('analytics.empty.pageviews')}
                items={(data?.languages ?? []).map((language) => ({
                  key: language.language,
                  label: <span dir="auto">{languageName(language.language, locale)}</span>,
                  value: language.views,
                }))}
                loading={loading}
                unknown={unknown}
              />
            </InsightCard>
          </div>

          <InsightCard description={t('analytics.perf.description')} title={t('analytics.page.speed.title')}>
            <VitalsCards loading={loading} summary={data?.webVitals} unknown={unknown} />
          </InsightCard>

          <InsightCard description={t('analytics.page.crawlers.description')} title={t('analytics.page.crawlers.title')}>
            <SimpleTable
              caption={t('analytics.page.crawlers.title')}
              columns={[
                { key: 'bot', header: t('analytics.ai.column.bot'), cell: (row) => <span dir="ltr">{row.bot}</span> },
                { key: 'operator', header: t('analytics.ai.column.operator'), cell: (row) => <span dir="auto">{row.operator}</span> },
                { key: 'requests', header: t('analytics.ai.column.requests'), cell: (row) => format.count(row.requests), numeric: true },
                {
                  key: 'last',
                  header: t('analytics.ai.column.lastSeen'),
                  cell: (row) => <span title={format.dateTime(row.lastSeenAt)}>{format.relativeTime(row.lastSeenAt)}</span>,
                  numeric: true,
                },
              ]}
              empty={t('analytics.page.crawlers.empty')}
              loading={loading}
              rowKey={(row) => row.bot}
              rows={data?.aiCrawlers ?? []}
              unknown={unknown}
            />
          </InsightCard>
        </>
      )}
    </div>
  );
}
