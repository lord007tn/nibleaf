import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@nibleaf/design-system/components/ui/tabs';
import { useT } from '@nibleaf/i18n/react';
import type { AnalyticsRange } from '@nibleaf/validators';
import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useProjectAnalytics } from '@/hooks/api/analytics';
import { useFormatters } from '@/lib/format';
import { AnalyticsProvider, useAnalyticsFilters } from '@/providers/analytics-provider';

export const Route = createFileRoute('/app/projects/$projectId/analytics')({
  component: ProjectAnalyticsRoute,
});

const RANGE_TABS: AnalyticsRange[] = ['24h', '7d', '30d', '90d'];

function ProjectAnalyticsRoute() {
  return (
    <AnalyticsProvider defaultRange="7d">
      <AnalyticsPage />
    </AnalyticsProvider>
  );
}

function AnalyticsPage() {
  const { projectId } = Route.useParams();
  const t = useT();
  const { range, setRange, timezone } = useAnalyticsFilters();
  const { data, isPending, isError } = useProjectAnalytics(projectId, range, { timezone });
  const unavailable = isError || data?.availability === 'unavailable';
  const partial = data?.availability === 'partial';
  const unknownOr = (empty: string) => (unavailable ? t('analytics.state.unknown') : empty);
  const hasTimeseries = (data?.timeseries ?? []).some((point) => point.views > 0);

  return (
    <div className="w-full px-6 py-8 xl:px-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t('analytics.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('analytics.subtitleSite')}</p>
        </div>
        <Tabs onValueChange={(value) => setRange(value as AnalyticsRange)} value={range}>
          <TabsList>
            {RANGE_TABS.map((value) => (
              <TabsTrigger key={value} value={value}>
                {value}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
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
        <StatCard label={t('analytics.kpi.pageViews')} value={data?.totalViews ?? null} loading={isPending} />
        <StatCard label={t('analytics.kpi.uniqueVisitors')} value={data?.uniqueVisitors ?? null} loading={isPending} />
        <StatCard label={t('analytics.kpi.searches')} value={data?.searches.total ?? null} loading={isPending} />
        <StatCard label={t('analytics.kpi.zeroResults')} value={data?.searches.zeroResults ?? null} loading={isPending} />
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="mb-4 font-medium text-sm">{t('analytics.chart.pageviewsOverTime')}</div>
        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : unavailable ? (
          <p className="py-20 text-center text-muted-foreground text-sm">{t('analytics.state.unknown')}</p>
        ) : !hasTimeseries ? (
          <p className="py-20 text-center text-muted-foreground text-sm">{t('analytics.empty.pageviews')}</p>
        ) : (
          <ResponsiveContainer height={260} width="100%">
            <AreaChart data={data?.timeseries ?? []}>
              <defs>
                <linearGradient id="views" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                fontSize={11}
                stroke="var(--muted-foreground)"
                tickLine={false}
                axisLine={false}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis allowDecimals={false} fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={28} />
              <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
              {/* Show a dot for tiny series (e.g. 24h = 1 point) so it isn't invisible. */}
              <Area
                dataKey="views"
                fill="url(#views)"
                stroke="var(--chart-1)"
                strokeWidth={2}
                type="monotone"
                dot={(data?.timeseries?.length ?? 0) <= 2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListCard
          title={t('analytics.section.topPages')}
          empty={unknownOr(t('analytics.empty.pageviews'))}
          items={(data?.topPages ?? []).map((p) => ({ label: `/${p.path}`, value: p.views }))}
        />
        {data?.searches.queryTerms === 'legacy' ? (
          <ListCard
            title={t('analytics.section.topSearches')}
            empty={unknownOr(t('analytics.empty.searches'))}
            items={(data?.topSearches ?? []).map((s) => ({ label: s.query, value: s.count }))}
          />
        ) : (
          <ListCard
            title={t('analytics.section.searchQuality')}
            empty={unknownOr(t('analytics.empty.searches'))}
            items={[
              ...(data?.searches.clickedResults === null || data?.searches.clickedResults === undefined
                ? []
                : [{ label: t('analytics.kpi.resultClicks'), value: data.searches.clickedResults }]),
              ...(data?.searches.averageLatencyMs === null || data?.searches.averageLatencyMs === undefined
                ? []
                : [{ label: t('analytics.kpi.averageLatencyMs'), value: data.searches.averageLatencyMs }]),
            ]}
          />
        )}
        <ListCard
          title={t('analytics.section.languages')}
          empty={unknownOr(t('analytics.empty.pageviews'))}
          items={(data?.languages ?? []).map((l) => ({ label: languageName(l.language), value: l.views }))}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListCard
          title={t('analytics.section.aiAnswers')}
          empty={unknownOr(t('analytics.empty.ai'))}
          items={[
            ...(data?.ai.answersCompleted === null || data?.ai.answersCompleted === undefined
              ? []
              : [{ label: t('analytics.kpi.answersCompleted'), value: data.ai.answersCompleted }]),
            ...(data?.ai.answersFailed === null || data?.ai.answersFailed === undefined
              ? []
              : [{ label: t('analytics.kpi.answersFailed'), value: data.ai.answersFailed }]),
            ...(data?.ai.costMicros === null || data?.ai.costMicros === undefined
              ? []
              : [{ label: t('analytics.kpi.aiCostMicros'), value: data.ai.costMicros }]),
          ]}
        />
        <ListCard
          title={t('analytics.section.noAnswerReasons')}
          empty={unknownOr(t('analytics.empty.noAnswers'))}
          items={(data?.noAnswerReasons ?? []).map((item) => ({ label: item.reason.replaceAll('_', ' '), value: item.count }))}
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

function StatCard({ label, value, loading }: { label: string; value: number | null; loading: boolean }) {
  const { number } = useFormatters();
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-muted-foreground text-sm">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-9 w-20" />
      ) : (
        <div className="mt-2 font-semibold text-3xl tabular-nums tracking-tight">{value === null ? '—' : number(value)}</div>
      )}
    </div>
  );
}

function ListCard({ title, items, empty }: { title: string; items: Array<{ label: string; value: number }>; empty: string }) {
  const { number } = useFormatters();
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 font-medium text-sm">{title}</div>
      {items.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground text-sm">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate text-foreground/80">{item.label}</span>
              <span className="font-mono text-muted-foreground tabular-nums">{number(item.value)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
