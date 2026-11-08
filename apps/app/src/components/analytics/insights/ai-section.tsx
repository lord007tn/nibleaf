import { Badge } from '@nibleaf/design-system/components/ui/badge';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { BookOpen, Bot, MessageCircleQuestion, ShieldCheck, Sparkles } from 'lucide-react';
import { type AiVisibilityInsights, useAiVisibilityInsights } from '@/hooks/api/analytics';
import { SimpleTable } from './data-table';
import { DraftingConnections } from './drafting-connections';
import type { InsightsSearch } from './filters';
import { InsightCard, PageLabel, RankedList } from './insight-card';
import { CHART_GROUPS, groupCrawlerSeries, insightsState, mergeSeries } from './insights-data';
import { InsightsEmpty, InsightsRegion, type InsightsRetry, InsightsStatus, insightsRetry } from './insights-status';
import { DeltaBadge, KpiCard, KpiGrid } from './kpi-card';
import { AI_SOURCE_NAMES, CRAWLER_CATEGORY_LABELS, RESOURCE_LABELS } from './labels';
import { countDelta } from './metrics';
import { PageInsightsLink } from './section-links';
import { TrendChart, useSeriesSummary } from './trend-chart';
import { useInsightFormat } from './use-insight-format';
import { useInsightsFilters } from './use-insights-filters';

type BotRow = AiVisibilityInsights['bots'][number];
type CrawledPage = AiVisibilityInsights['topCrawledPages'][number];

const EXPLAINERS: ReadonlyArray<{ category: 'ai_training' | 'ai_search' | 'ai_assistant'; body: MessageKey; icon: typeof BookOpen }> = [
  { category: 'ai_training', body: 'analytics.ai.explain.training', icon: BookOpen },
  { category: 'ai_search', body: 'analytics.ai.explain.search', icon: Sparkles },
  { category: 'ai_assistant', body: 'analytics.ai.explain.assistant', icon: MessageCircleQuestion },
];

export function AiSection() {
  const { projectId, filters, query } = useInsightsFilters();
  const result = useAiVisibilityInsights(projectId, query);
  return <AiView data={result.data} retry={insightsRetry(result)} filters={filters} projectId={projectId} state={insightsState(result)} />;
}

function AiView({
  data,
  state,
  retry,
  projectId,
  filters,
}: {
  data: AiVisibilityInsights | undefined;
  state: ReturnType<typeof insightsState>;
  retry: InsightsRetry;
  projectId: string;
  filters: InsightsSearch;
}) {
  const t = useT();
  const format = useInsightFormat();
  const summarize = useSeriesSummary();
  const { loading, unknown } = state;
  const kpis = data?.kpis;
  const compare = Boolean(data?.meta.previous);
  const granularity = data?.meta.granularity ?? 'day';
  if (state.availability === 'not_configured' || state.availability === 'reads_disabled')
    return <InsightsStatus projectId={projectId} retry={retry} state={state} />;
  const nothing =
    data !== undefined &&
    !unknown &&
    data.bots.length === 0 &&
    data.assistantReferrals.length === 0 &&
    (data.kpis.aiCrawlerRequests.value ?? 0) === 0;

  const explainer = (
    <InsightCard description={t('analytics.ai.explain.description')} title={t('analytics.ai.explain.title')}>
      <ul className="grid gap-4 md:grid-cols-3">
        {EXPLAINERS.map(({ category, body, icon: Icon }) => (
          <li className="flex gap-3" key={category}>
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <Icon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="font-medium text-sm">{t(CRAWLER_CATEGORY_LABELS[category])}</p>
              <p className="mt-0.5 text-muted-foreground text-sm">{t(body)}</p>
            </div>
          </li>
        ))}
      </ul>
    </InsightCard>
  );

  return (
    <InsightsRegion loading={loading}>
      <InsightsStatus projectId={projectId} retry={retry} state={state} />
      <DraftingConnections data={data?.drafting} loading={loading} unknown={unknown} />
      {nothing ? (
        <>
          <InsightsEmpty body={t('analytics.ai.empty.body')} icon={<Bot aria-hidden className="size-5" />} title={t('analytics.ai.empty.title')} />
          {explainer}
        </>
      ) : (
        <>
          <KpiGrid className="xl:grid-cols-4">
            <KpiCard
              compared={kpis?.aiAssistantVisits}
              hint={t('analytics.metric.aiAssistantVisits.hint')}
              kind="count"
              label={t('analytics.metric.aiAssistantVisits')}
              loading={loading}
              polarity="higher_is_better"
            />
            <KpiCard
              compared={kpis?.aiAssistantFetches}
              hint={t('analytics.metric.aiAssistantFetches.hint')}
              kind="count"
              label={t('analytics.metric.aiAssistantFetches')}
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
            <KpiCard
              compared={kpis?.crawledPages}
              hint={t('analytics.metric.crawledPages.hint')}
              kind="count"
              label={t('analytics.metric.crawledPages')}
              loading={loading}
              polarity="higher_is_better"
            />
          </KpiGrid>

          {explainer}

          <InsightCard description={t('analytics.ai.crawlers.description')} title={t('analytics.ai.crawlers.title')}>
            <TrendChart
              empty={t('analytics.ai.crawlers.empty')}
              granularity={granularity}
              loading={loading}
              rows={mergeSeries(groupCrawlerSeries(data?.crawlerSeries ?? []))}
              series={CHART_GROUPS.map((group, index) => ({
                key: group,
                label: t(CRAWLER_CATEGORY_LABELS[group]),
                color: `var(--chart-${index + 1})`,
              }))}
              stacked
              summary={t('analytics.ai.crawlers.summary', {
                total: format.count(kpis?.aiCrawlerRequests.value ?? null),
                engines: format.count(kpis?.searchEngineRequests.value ?? null),
              })}
              unknown={unknown}
            />
          </InsightCard>

          <InsightCard description={t('analytics.ai.bots.description')} title={t('analytics.ai.bots.title')}>
            <SimpleTable
              caption={t('analytics.ai.bots.title')}
              columns={[
                {
                  key: 'bot',
                  header: t('analytics.ai.column.bot'),
                  cell: (row: BotRow) => (
                    <span className="flex flex-col">
                      <span className="font-medium" dir="ltr">
                        {row.bot}
                      </span>
                      <span className="text-muted-foreground text-xs" dir="auto">
                        {row.operator}
                      </span>
                    </span>
                  ),
                },
                {
                  key: 'category',
                  header: t('analytics.ai.column.category'),
                  cell: (row: BotRow) => <Badge variant="outline">{t(CRAWLER_CATEGORY_LABELS[row.category])}</Badge>,
                },
                {
                  key: 'requests',
                  header: t('analytics.ai.column.requests'),
                  cell: (row: BotRow) => {
                    const delta = compare ? countDelta(row.requests, row.previousRequests) : null;
                    return (
                      <span className="inline-flex items-center gap-2">
                        {format.count(row.requests)}
                        {delta ? <DeltaBadge delta={delta} polarity="neutral" /> : null}
                      </span>
                    );
                  },
                  numeric: true,
                },
                { key: 'pages', header: t('analytics.ai.column.pages'), cell: (row: BotRow) => format.count(row.pages), numeric: true },
                {
                  key: 'last',
                  header: t('analytics.ai.column.lastSeen'),
                  cell: (row: BotRow) => <span title={format.dateTime(row.lastSeenAt)}>{format.relativeTime(row.lastSeenAt)}</span>,
                  numeric: true,
                },
                {
                  key: 'verification',
                  header: t('analytics.ai.column.identity'),
                  cell: (row: BotRow) =>
                    row.verification === 'verified' ? (
                      <Badge className="border-success/30 bg-success/10 text-success" variant="outline">
                        <ShieldCheck aria-hidden />
                        {t('analytics.ai.verified')}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-xs" title={t('analytics.ai.claimed.hint')}>
                        {t('analytics.ai.claimed')}
                      </span>
                    ),
                },
              ]}
              empty={t('analytics.ai.crawlers.empty')}
              loading={loading}
              rowKey={(row) => row.bot}
              rows={data?.bots ?? []}
              unknown={unknown}
            />
          </InsightCard>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <InsightCard description={t('analytics.ai.resources.description')} title={t('analytics.ai.resources.title')}>
              <RankedList
                empty={t('analytics.ai.crawlers.empty')}
                items={(data?.resources ?? []).map((resource) => ({
                  key: resource.resource,
                  label: t(RESOURCE_LABELS[resource.resource]),
                  value: resource.requests,
                }))}
                loading={loading}
                unknown={unknown}
              />
            </InsightCard>
            <InsightCard description={t('analytics.ai.referrals.description')} title={t('analytics.ai.referrals.title')}>
              <RankedList
                empty={t('analytics.ai.referrals.empty')}
                items={[...(data?.assistantReferrals ?? [])]
                  .sort((a, b) => b.visits - a.visits)
                  .map((referral) => ({
                    key: referral.source,
                    label: <span dir="ltr">{AI_SOURCE_NAMES[referral.source] ?? t('analytics.ai.source.other')}</span>,
                    value: referral.visits,
                    delta: compare ? countDelta(referral.visits, referral.previousVisits) : null,
                  }))}
                loading={loading}
                unknown={unknown}
              />
            </InsightCard>
          </div>

          <InsightCard description={t('analytics.ai.referralTrend.description')} title={t('analytics.ai.referralTrend.title')}>
            <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <TrendChart
                empty={t('analytics.ai.referrals.empty')}
                granularity={granularity}
                loading={loading}
                rows={mergeSeries([{ key: 'visits', points: data?.assistantReferralSeries ?? [] }])}
                series={[{ key: 'visits', label: t('analytics.metric.aiAssistantVisits'), color: 'var(--chart-1)' }]}
                summary={summarize(t('analytics.metric.aiAssistantVisits'), data?.assistantReferralSeries ?? [], granularity)}
                unknown={unknown}
              />
              <RankedList
                empty={t('analytics.ai.referrals.empty')}
                items={(data?.assistantLandingPages ?? []).map((page) => ({
                  key: page.path,
                  label: (
                    <PageInsightsLink filters={filters} path={page.path} projectId={projectId}>
                      <PageLabel path={page.path} title={page.title} />
                    </PageInsightsLink>
                  ),
                  value: page.visits,
                }))}
                label={t('analytics.ai.landing.title')}
                loading={loading}
                unknown={unknown}
              />
            </div>
          </InsightCard>

          <InsightCard description={t('analytics.ai.pages.description')} title={t('analytics.ai.pages.title')}>
            <SimpleTable
              caption={t('analytics.ai.pages.title')}
              columns={[
                {
                  key: 'page',
                  header: t('analytics.pages.column.page'),
                  cell: (row: CrawledPage) => (
                    <PageInsightsLink className="block max-w-[18rem]" filters={filters} path={row.path} projectId={projectId}>
                      <PageLabel path={row.path} title={row.title} />
                    </PageInsightsLink>
                  ),
                },
                { key: 'requests', header: t('analytics.ai.column.requests'), cell: (row: CrawledPage) => format.count(row.requests), numeric: true },
                { key: 'bots', header: t('analytics.ai.column.bots'), cell: (row: CrawledPage) => format.count(row.bots), numeric: true },
                {
                  key: 'last',
                  header: t('analytics.ai.column.lastSeen'),
                  cell: (row: CrawledPage) => <span title={format.dateTime(row.lastSeenAt)}>{format.relativeTime(row.lastSeenAt)}</span>,
                  numeric: true,
                },
              ]}
              empty={t('analytics.ai.crawlers.empty')}
              loading={loading}
              rowKey={(row) => row.path}
              rows={data?.topCrawledPages ?? []}
              unknown={unknown}
            />
          </InsightCard>
        </>
      )}
    </InsightsRegion>
  );
}
