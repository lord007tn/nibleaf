import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Skeleton, SkeletonListRow, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { Bot, Clock, Eye, MousePointerClick, ScrollText, Search, SearchX, ThumbsUp, Users } from 'lucide-react';
import { type OverviewInsights, useOverviewInsights } from '@/hooks/api/analytics';
import type { InsightsSearch } from './filters';
import { InsightCard, PageLabel, RankedList } from './insight-card';
import { alignWithPrevious, dataFreshness, insightsState } from './insights-data';
import { InsightsEmpty, InsightsRegion, type InsightsRetry, InsightsStatus, insightsRetry } from './insights-status';
import { KpiCard, KpiGrid } from './kpi-card';
import { CHANNEL_LABELS, REASON_HINTS, REASON_LABELS } from './labels';
import { countDelta } from './metrics';
import { HiddenTermsEmpty, TermsEmptyState, TermText } from './search-terms';
import { PageInsightsLink, SectionLink } from './section-links';
import { TrendChart, useSeriesSummary } from './trend-chart';
import { useInsightFormat } from './use-insight-format';
import { useInsightsFilters } from './use-insights-filters';

/** No human visit and no search at all in the period: show the "publish and share" empty state. */
const isOverviewEmpty = (data: OverviewInsights) =>
  data.kpis.pageViews.value === 0 && (data.kpis.searches.value ?? 0) === 0 && !data.pageViewsSeries.some((point) => point.value > 0);

export function OverviewSection() {
  const { projectId, filters, query } = useInsightsFilters();
  const result = useOverviewInsights(projectId, query);
  return <OverviewView data={result.data} retry={insightsRetry(result)} filters={filters} projectId={projectId} state={insightsState(result)} />;
}

function OverviewView({
  data,
  state,
  retry,
  projectId,
  filters,
}: {
  data: OverviewInsights | undefined;
  state: ReturnType<typeof insightsState>;
  retry: InsightsRetry;
  projectId: string;
  filters: InsightsSearch;
}) {
  const t = useT();
  const format = useInsightFormat();
  const summarize = useSeriesSummary();
  const { loading, unknown } = state;
  const compare = Boolean(data?.meta.previous);
  const kpis = data?.kpis;

  if (state.availability === 'not_configured' || state.availability === 'reads_disabled')
    return <InsightsStatus projectId={projectId} retry={retry} state={state} />;
  if (data && !unknown && isOverviewEmpty(data)) {
    return (
      <div className="flex flex-col gap-4">
        <InsightsStatus projectId={projectId} retry={retry} state={state} />
        {dataFreshness(state.lastEventAt) === 'never' || dataFreshness(state.lastEventAt) === 'unknown' ? (
          <InsightsEmpty body={t('analytics.empty.noVisits.body')} title={t('analytics.empty.noVisits.title')} />
        ) : (
          <InsightsEmpty body={t('analytics.empty.noVisitsInPeriod.body')} title={t('analytics.empty.noVisitsInPeriod.title')} />
        )}
      </div>
    );
  }

  const granularity = data?.meta.granularity ?? 'day';
  const rows = alignWithPrevious(data?.pageViewsSeries ?? [], compare ? (data?.previousPageViewsSeries ?? []) : []);
  const feedbackTotal = (data?.feedback.helpful ?? 0) + (data?.feedback.notHelpful ?? 0);

  return (
    <InsightsRegion loading={loading}>
      <InsightsStatus projectId={projectId} retry={retry} state={state} />

      <KpiGrid className="xl:grid-cols-4">
        <KpiCard
          compared={kpis?.pageViews}
          hint={t('analytics.metric.pageViews.hint')}
          icon={<Eye aria-hidden className="size-4" />}
          kind="count"
          label={t('analytics.metric.pageViews')}
          loading={loading}
          polarity="higher_is_better"
        />
        <KpiCard
          compared={kpis?.visits}
          hint={t('analytics.metric.visits.consentHint')}
          icon={<Users aria-hidden className="size-4" />}
          kind="count"
          label={t('analytics.metric.visits')}
          loading={loading}
          polarity="higher_is_better"
        />
        <KpiCard
          compared={kpis?.avgEngagedMs}
          hint={t('analytics.metric.engagedTime.hint')}
          icon={<Clock aria-hidden className="size-4" />}
          kind="duration"
          label={t('analytics.metric.engagedTime')}
          loading={loading}
          polarity="higher_is_better"
        />
        <KpiCard
          compared={kpis?.avgScrollDepth}
          hint={t('analytics.metric.scrollDepth.hint')}
          icon={<ScrollText aria-hidden className="size-4" />}
          kind="rate"
          label={t('analytics.metric.scrollDepth')}
          loading={loading}
          polarity="higher_is_better"
        />
        <KpiCard
          compared={kpis?.searches}
          hint={t('analytics.metric.searches.hint')}
          icon={<Search aria-hidden className="size-4" />}
          kind="count"
          label={t('analytics.metric.searches')}
          loading={loading}
          polarity="neutral"
        />
        <KpiCard
          compared={kpis?.searchSuccessRate}
          hint={t('analytics.metric.searchSuccess.hint')}
          icon={<MousePointerClick aria-hidden className="size-4" />}
          kind="rate"
          label={t('analytics.metric.searchSuccess')}
          loading={loading}
          polarity="higher_is_better"
        />
        <KpiCard
          compared={kpis?.zeroResultRate}
          hint={t('analytics.metric.zeroResultRate.hint')}
          icon={<SearchX aria-hidden className="size-4" />}
          kind="rate"
          label={t('analytics.metric.zeroResultRate')}
          loading={loading}
          polarity="lower_is_better"
        />
        <KpiCard
          compared={kpis?.helpfulRate}
          hint={t('analytics.metric.helpfulRate.hint')}
          icon={<ThumbsUp aria-hidden className="size-4" />}
          kind="rate"
          label={t('analytics.metric.helpfulRate')}
          loading={loading}
          polarity="higher_is_better"
        />
      </KpiGrid>

      <InsightCard
        action={
          <SectionLink filters={filters} projectId={projectId} section="pages">
            {t('analytics.overview.allPages')}
          </SectionLink>
        }
        description={t('analytics.overview.reading.description')}
        title={t('analytics.overview.reading.title')}
      >
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <TrendChart
            empty={t('analytics.empty.pageviews')}
            granularity={granularity}
            loading={loading}
            rows={rows}
            series={[
              { key: 'current', label: t('analytics.metric.pageViews'), color: 'var(--chart-1)' },
              ...(compare ? [{ key: 'previous', label: t('analytics.chart.previousPeriod'), color: 'var(--muted-foreground)', dashed: true }] : []),
            ]}
            summary={summarize(t('analytics.metric.pageViews'), data?.pageViewsSeries ?? [], granularity)}
            unknown={unknown}
          />
          <RankedList
            empty={t('analytics.empty.pageviews')}
            items={(data?.topPages ?? []).slice(0, 6).map((page) => ({
              key: page.path,
              label: (
                <PageInsightsLink filters={filters} path={page.path} projectId={projectId}>
                  <PageLabel path={page.path} title={page.title} />
                </PageInsightsLink>
              ),
              value: page.views,
              delta: compare ? countDelta(page.views, page.previousViews) : null,
            }))}
            label={t('analytics.overview.topPages')}
            loading={loading}
            rows={6}
            unknown={unknown}
          />
        </div>
      </InsightCard>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <InsightCard
          action={
            <SectionLink filters={filters} projectId={projectId} section="search">
              {t('analytics.overview.allSearches')}
            </SectionLink>
          }
          description={t('analytics.overview.cantFind.description')}
          title={t('analytics.overview.cantFind.title')}
        >
          <RankedList
            empty={data && !unknown ? cantFindEmpty({ data, projectId, t, format }) : t('analytics.overview.cantFind.empty')}
            items={(data?.failedSearches ?? []).slice(0, 6).map((term) => ({
              key: term.termId,
              label: <TermText term={term} />,
              value: term.searches,
              meta: term.zeroResultSearches > 0 ? t('analytics.search.noResultsBadge') : t('analytics.search.noClicksBadge'),
            }))}
            loading={loading}
            unknown={unknown}
          />
        </InsightCard>

        <InsightCard description={t('analytics.overview.needsWork.description')} title={t('analytics.overview.needsWork.title')}>
          {loading ? (
            <div aria-hidden className="divide-y divide-border" data-list-skeleton="">
              {['a', 'b', 'c', 'd'].map((key) => (
                <SkeletonListRow key={key} withIcon={false} />
              ))}
            </div>
          ) : unknown ? (
            <p className="py-6 text-center text-muted-foreground text-sm">{t('analytics.state.unknown')}</p>
          ) : (data?.pagesNeedingWork ?? []).length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">{t('analytics.overview.needsWork.empty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {(data?.pagesNeedingWork ?? []).slice(0, 6).map((page) => (
                <li className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0" key={page.path}>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <PageInsightsLink filters={filters} path={page.path} projectId={projectId}>
                      <PageLabel path={page.path} title={page.title} />
                    </PageInsightsLink>
                    <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                      {t('analytics.overview.needsWork.views', { count: format.count(page.views) })}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {page.reasons.map((reason) => (
                      <Badge key={reason} title={t(REASON_HINTS[reason])} variant="outline">
                        {t(REASON_LABELS[reason])}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </InsightCard>

        <InsightCard description={t('analytics.overview.channels.description')} title={t('analytics.overview.channels.title')}>
          <RankedList
            empty={t('analytics.empty.pageviews')}
            items={(data?.channels ?? []).map((channel) => ({
              key: channel.channel,
              label: (
                <span className="flex items-center gap-1.5 truncate">
                  {channel.channel === 'ai_assistant' ? <Bot aria-hidden className="size-3.5 text-muted-foreground" /> : null}
                  {t(CHANNEL_LABELS[channel.channel])}
                </span>
              ),
              value: channel.visits,
              delta: compare ? countDelta(channel.visits, channel.previousVisits) : null,
            }))}
            loading={loading}
            rows={4}
            unknown={unknown}
          />
        </InsightCard>

        <InsightCard
          action={
            <SectionLink filters={filters} projectId={projectId} section="feedback">
              {t('analytics.overview.allFeedback')}
            </SectionLink>
          }
          description={t('analytics.overview.feedback.description')}
          title={t('analytics.overview.feedback.title')}
        >
          {loading ? (
            <FeedbackSplitSkeleton />
          ) : unknown ? (
            <p className="py-6 text-center text-muted-foreground text-sm">{t('analytics.state.unknown')}</p>
          ) : feedbackTotal === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">{t('analytics.feedback.empty')}</p>
          ) : (
            <FeedbackSplit helpful={data?.feedback.helpful ?? 0} notHelpful={data?.feedback.notHelpful ?? 0} />
          )}
        </InsightCard>
      </div>

      <InsightCard
        action={
          <SectionLink filters={filters} projectId={projectId} section="ai">
            {t('analytics.overview.aiDetails')}
          </SectionLink>
        }
        description={t('analytics.overview.ai.description')}
        title={t('analytics.overview.ai.title')}
      >
        <KpiGrid>
          <KpiCard
            compared={kpis?.aiAssistantVisits}
            hint={t('analytics.metric.aiAssistantVisits.hint')}
            kind="count"
            label={t('analytics.metric.aiAssistantVisits')}
            loading={loading}
            polarity="higher_is_better"
          />
          <KpiCard
            compared={kpis?.aiCrawlerRequests}
            hint={t('analytics.metric.aiCrawlerRequests.hint')}
            kind="count"
            label={t('analytics.metric.aiCrawlerRequests')}
            loading={loading}
            polarity="neutral"
          />
        </KpiGrid>
      </InsightCard>
    </InsightsRegion>
  );
}

/**
 * "What can't they find?" with no term to list: keep the known share of
 * searches that found nothing, and say why the terms are missing (setting,
 * private site, or too few visits per term). "No failed searches" only when
 * the zero-result rate really is zero.
 */
function cantFindEmpty({
  data,
  projectId,
  t,
  format,
}: {
  data: OverviewInsights;
  projectId: string;
  t: ReturnType<typeof useT>;
  format: ReturnType<typeof useInsightFormat>;
}) {
  const searches = data.kpis.searches.value;
  const rate = data.kpis.zeroResultRate.value;
  const known =
    rate === null || !searches
      ? null
      : rate > 0
        ? t('analytics.overview.cantFind.zeroShare', { rate: format.rate(rate), searches: format.count(searches) })
        : t('analytics.search.noneEmpty');
  if (data.searchTermsVisibility !== 'visible') {
    return <HiddenTermsEmpty known={known} projectId={projectId} visibility={data.searchTermsVisibility} />;
  }
  if (searches === 0) return t('analytics.empty.searches');
  if (rate === 0) return t('analytics.overview.cantFind.empty');
  return <TermsEmptyState known={known} reason={t('analytics.search.rareHidden')} />;
}

/** FeedbackSplit's shape while the first response loads: the rate, the bar and the two counts. */
export function FeedbackSplitSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3" data-feedback-skeleton="">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Skeleton className="h-9 w-20" />
        <Skeleton className="h-4 w-28" />
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
      <div className="grid grid-cols-2 gap-2">
        <SkeletonText className="gap-1" lines={2} />
        <SkeletonText className="gap-1" lines={2} />
      </div>
    </div>
  );
}

/** Helpful vs not helpful as two numbers and one proportional bar. */
export function FeedbackSplit({ helpful, notHelpful }: { helpful: number; notHelpful: number }) {
  const t = useT();
  const format = useInsightFormat();
  const total = helpful + notHelpful;
  const share = total === 0 ? 0 : helpful / total;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold text-3xl tabular-nums">{format.rate(total === 0 ? null : share)}</span>
        <span className="text-muted-foreground text-sm">{t('analytics.feedback.helpfulShare')}</span>
      </div>
      <div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-muted">
        <span className="h-full bg-success" style={{ width: `${Math.round(share * 100)}%` }} />
        <span className="h-full bg-destructive/70" style={{ width: `${Math.round((1 - share) * 100)}%` }} />
      </div>
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">{t('analytics.feedback.helpful')}</dt>
          <dd className="font-medium tabular-nums">{format.count(helpful)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t('analytics.feedback.notHelpful')}</dt>
          <dd className="font-medium tabular-nums">{format.count(notHelpful)}</dd>
        </div>
      </dl>
    </div>
  );
}
