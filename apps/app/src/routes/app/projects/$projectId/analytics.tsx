import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, BarChart3, Search, SearchX, Users } from 'lucide-react';
import { ListCard } from '@/components/analytics/list-card';
import { RangeTabs } from '@/components/analytics/range-tabs';
import { StatCard } from '@/components/analytics/stat-card';
import { ViewsTimeseriesChart } from '@/components/analytics/views-timeseries-chart';
import { useProjectAnalytics } from '@/hooks/api/analytics';
import { AnalyticsProvider, useAnalyticsFilters } from '@/providers/analytics-provider';

/** No-answer reasons from the ClickHouse event schema; unknown values fall back to the raw reason. */
const NO_ANSWER_REASON_KEYS: Record<string, MessageKey> = {
  no_match: 'analytics.noAnswerReason.no_match',
  provider_error: 'analytics.noAnswerReason.provider_error',
  empty_corpus: 'analytics.noAnswerReason.empty_corpus',
  filtered: 'analytics.noAnswerReason.filtered',
  low_confidence: 'analytics.noAnswerReason.low_confidence',
  policy: 'analytics.noAnswerReason.policy',
  unknown: 'analytics.noAnswerReason.unknown',
  cancelled: 'analytics.noAnswerReason.cancelled',
  quota: 'analytics.noAnswerReason.quota',
};

export const Route = createFileRoute('/app/projects/$projectId/analytics')({
  component: ProjectAnalyticsRoute,
});

function ProjectAnalyticsRoute() {
  return (
    <AnalyticsProvider>
      <AnalyticsPage />
    </AnalyticsProvider>
  );
}

function AnalyticsPage() {
  const { projectId } = Route.useParams();
  const t = useT();
  const { range, setRange, timezone } = useAnalyticsFilters();
  const { data, isPending, isError } = useProjectAnalytics(projectId, range, { timezone });
  const reasonLabel = (reason: string) => {
    const key = NO_ANSWER_REASON_KEYS[reason];
    return key ? t(key) : reason.replaceAll('_', ' ');
  };
  const unavailable = isError || data?.availability === 'unavailable';
  const partial = data?.availability === 'partial';
  const unknownOr = (empty: string) => (unavailable ? t('analytics.state.unknown') : empty);
  const hasTimeseries = (data?.timeseries ?? []).some((point) => point.views > 0);

  return (
    <div className="w-full px-6 py-8 xl:px-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t('analytics.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('analytics.subtitleSite')}</p>
        </div>
        <RangeTabs value={range} onValueChange={setRange} />
      </div>

      {unavailable ? (
        <Alert className="mt-6" variant="warning">
          <AlertTriangle />
          <AlertTitle>{t('analytics.state.unavailable.title')}</AlertTitle>
          <AlertDescription>{t('analytics.state.unavailable.body')}</AlertDescription>
        </Alert>
      ) : null}
      {partial ? (
        <Alert className="mt-6" variant="info">
          <AlertTriangle />
          <AlertTitle>{t('analytics.state.partial.title')}</AlertTitle>
          <AlertDescription>{t('analytics.state.partial.body')}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('analytics.kpi.pageViews')} value={data?.totalViews ?? null} icon={<BarChart3 className="size-4" />} loading={isPending} />
        <StatCard
          label={t('analytics.kpi.uniqueVisitors')}
          value={data?.uniqueVisitors ?? null}
          icon={<Users className="size-4" />}
          loading={isPending}
        />
        <StatCard label={t('analytics.kpi.searches')} value={data?.searches.total ?? null} icon={<Search className="size-4" />} loading={isPending} />
        <StatCard
          label={t('analytics.kpi.zeroResults')}
          value={data?.searches.zeroResults ?? null}
          icon={<SearchX className="size-4" />}
          loading={isPending}
        />
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="mb-4 font-medium text-sm">{t('analytics.chart.pageviewsOverTime')}</div>
        {isPending ? (
          <Skeleton className="h-[240px] w-full" />
        ) : unavailable ? (
          <div className="grid h-[240px] place-items-center text-center text-muted-foreground text-sm">{t('analytics.state.unknown')}</div>
        ) : hasTimeseries ? (
          <ViewsTimeseriesChart data={data?.timeseries ?? []} />
        ) : (
          <div className="grid h-[240px] place-items-center text-center text-muted-foreground text-sm">{t('analytics.empty.pageviews')}</div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListCard
          title={t('analytics.section.topPages')}
          loading={isPending}
          empty={unknownOr(t('analytics.empty.pageviews'))}
          items={(data?.topPages ?? []).map((p) => ({
            key: p.path,
            label: (
              <span className="truncate" dir="ltr">
                /{p.path}
              </span>
            ),
            value: p.views,
          }))}
        />
        {data?.searches.queryTerms === 'legacy' ? (
          <ListCard
            title={t('analytics.section.topSearches')}
            loading={isPending}
            empty={unknownOr(t('analytics.empty.searches'))}
            items={(data?.topSearches ?? []).map((s) => ({
              key: s.query,
              label: (
                <span className="font-mono text-xs" dir="auto">
                  {s.query}
                </span>
              ),
              value: s.count,
            }))}
          />
        ) : (
          <ListCard
            title={t('analytics.section.searchQuality')}
            loading={isPending}
            empty={unknownOr(t('analytics.empty.searches'))}
            items={[
              ...(data?.searches.clickedResults === null || data?.searches.clickedResults === undefined
                ? []
                : [{ key: 'clicks', label: t('analytics.kpi.resultClicks'), value: data.searches.clickedResults }]),
              ...(data?.searches.averageLatencyMs === null || data?.searches.averageLatencyMs === undefined
                ? []
                : [{ key: 'latency', label: t('analytics.kpi.averageLatencyMs'), value: data.searches.averageLatencyMs }]),
            ]}
          />
        )}
        <ListCard
          title={t('analytics.section.languages')}
          loading={isPending}
          empty={unknownOr(t('analytics.empty.pageviews'))}
          items={(data?.languages ?? []).map((l) => ({ key: l.language, label: <span dir="auto">{languageName(l.language)}</span>, value: l.views }))}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListCard
          title={t('analytics.section.aiAnswers')}
          loading={isPending}
          empty={unknownOr(t('analytics.empty.ai'))}
          items={[
            ...(data?.ai.answersCompleted === null || data?.ai.answersCompleted === undefined
              ? []
              : [{ key: 'completed', label: t('analytics.kpi.answersCompleted'), value: data.ai.answersCompleted }]),
            ...(data?.ai.answersFailed === null || data?.ai.answersFailed === undefined
              ? []
              : [{ key: 'failed', label: t('analytics.kpi.answersFailed'), value: data.ai.answersFailed }]),
            ...(data?.ai.costMicros === null || data?.ai.costMicros === undefined
              ? []
              : [{ key: 'cost', label: t('analytics.kpi.aiCostMicros'), value: data.ai.costMicros }]),
          ]}
        />
        <ListCard
          title={t('analytics.section.noAnswerReasons')}
          loading={isPending}
          empty={unknownOr(t('analytics.empty.noAnswers'))}
          items={(data?.noAnswerReasons ?? []).map((item) => ({
            key: item.reason,
            label: reasonLabel(item.reason),
            value: item.count,
          }))}
        />
      </div>

      <p className="mt-4 text-muted-foreground text-xs">{t('analytics.privacy.queryTerms')}</p>
    </div>
  );
}

/** A language code's endonym (e.g. "ar" → "العربية"), falling back to the code. */
function languageName(code: string): string {
  if (code === 'unknown') {
    return code;
  }
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}
