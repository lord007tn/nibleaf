import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@nibleaf/design-system/components/ui/tabs';
import { useT } from '@nibleaf/i18n/react';
import type { AnalyticsRange } from '@nibleaf/validators';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Activity, AlertTriangle, BarChart3, Search, Sparkles, Users } from 'lucide-react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarRow } from '@/components/analytics/bar-row';
import { ListCard } from '@/components/analytics/list-card';
import { StatCard } from '@/components/analytics/stat-card';
import { useWorkspaceAnalytics } from '@/hooks/api/analytics';
import { useFormatters } from '@/lib/format';
import { AnalyticsProvider, useAnalyticsFilters } from '@/providers/analytics-provider';

export const Route = createFileRoute('/app/(dashboard)/analytics')({
  component: WorkspaceAnalyticsRoute,
});

const RANGE_TABS: AnalyticsRange[] = ['24h', '7d', '30d', '90d'];

function WorkspaceAnalyticsRoute() {
  return (
    <AnalyticsProvider>
      <WorkspaceAnalyticsPage />
    </AnalyticsProvider>
  );
}

function WorkspaceAnalyticsPage() {
  const t = useT();
  const { number } = useFormatters();
  const EMPTY = t('analytics.empty.traffic');
  const navigate = useNavigate();
  const { range, setRange, timezone } = useAnalyticsFilters();
  const { data, isPending, isError } = useWorkspaceAnalytics(range, { timezone });
  const unavailable = isError || data?.availability === 'unavailable';
  const partial = data?.availability === 'partial';
  const emptyTraffic = unavailable ? t('analytics.state.unknown') : EMPTY;
  const emptySearches = unavailable ? t('analytics.state.unknown') : t('analytics.empty.searches');

  const byProject = data?.byProject ?? [];
  const maxProjectViews = Math.max(1, ...byProject.map((p) => p.views));
  const devices = data?.devices ?? [];
  const totalDevices = Math.max(
    1,
    devices.reduce((sum, d) => sum + d.count, 0),
  );
  const projectsWithTraffic = unavailable ? null : byProject.filter((p) => p.views > 0).length;
  const hasTimeseries = (data?.timeseries ?? []).some((d) => d.views > 0);
  const zeroResults = data?.searches && 'zeroResults' in data.searches ? data.searches.zeroResults : null;
  const clickedResults = data?.searches && 'clickedResults' in data.searches ? data.searches.clickedResults : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-3xl tracking-tight">{t('analytics.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('analytics.subtitle')}</p>
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
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>{t('analytics.state.unavailable.title')}</AlertTitle>
          <AlertDescription>{t('analytics.state.unavailable.body')}</AlertDescription>
        </Alert>
      ) : null}
      {partial ? (
        <Alert variant="info">
          <AlertTriangle />
          <AlertTitle>{t('analytics.state.partial.title')}</AlertTitle>
          <AlertDescription>{t('analytics.state.partial.body')}</AlertDescription>
        </Alert>
      ) : null}

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('analytics.kpi.pageViews')} value={data?.totalViews ?? null} icon={<BarChart3 className="size-4" />} loading={isPending} />
        <StatCard
          label={t('analytics.kpi.uniqueVisitors')}
          value={data?.uniqueVisitors ?? null}
          icon={<Users className="size-4" />}
          loading={isPending}
        />
        <StatCard label={t('analytics.kpi.searches')} value={data?.searches.total ?? null} icon={<Search className="size-4" />} loading={isPending} />
        <StatCard
          label={t('analytics.kpi.projectsWithTraffic')}
          value={projectsWithTraffic}
          icon={<Activity className="size-4" />}
          loading={isPending}
        />
      </div>

      {/* Pageviews chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 font-medium text-sm">{t('analytics.chart.pageviewsAllProjects')}</div>
        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : unavailable ? (
          <p className="py-20 text-center text-muted-foreground text-sm">{t('analytics.state.unknown')}</p>
        ) : hasTimeseries ? (
          <ResponsiveContainer height={260} width="100%">
            <BarChart data={data?.timeseries ?? []} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="date"
                fontSize={11}
                stroke="var(--muted-foreground)"
                tickLine={false}
                axisLine={false}
                tickFormatter={(d: string) => d.slice(5)}
              />
              <YAxis allowDecimals={false} fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={32} />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
              />
              <Bar dataKey="views" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="py-20 text-center text-muted-foreground text-sm">{EMPTY}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('analytics.kpi.zeroResults')} value={zeroResults ?? null} icon={<Search className="size-4" />} loading={isPending} />
        <StatCard label={t('analytics.kpi.resultClicks')} value={clickedResults ?? null} icon={<Search className="size-4" />} loading={isPending} />
        <StatCard
          label={t('analytics.kpi.answersCompleted')}
          value={data?.ai.answersCompleted ?? null}
          icon={<Sparkles className="size-4" />}
          loading={isPending}
        />
        <StatCard
          label={t('analytics.kpi.aiCostMicros')}
          value={data?.ai.costMicros ?? null}
          icon={<Sparkles className="size-4" />}
          loading={isPending}
        />
      </div>

      <p className="text-muted-foreground text-xs">{t('analytics.privacy.queryTerms')}</p>

      {/* By project + referrers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 font-medium text-sm">{t('analytics.section.byProject')}</div>
          {isPending ? (
            <div className="space-y-2.5">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : byProject.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">{emptyTraffic}</p>
          ) : (
            <div className="-mx-2">
              {byProject.map((p) => (
                <BarRow
                  key={p.projectId}
                  leading={<span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />}
                  label={p.name}
                  fraction={p.views / maxProjectViews}
                  value={number(p.views)}
                  color={p.color}
                  onClick={() => navigate({ to: '/app/projects/$projectId/analytics', params: { projectId: p.projectId } })}
                />
              ))}
            </div>
          )}
        </div>

        <ListCard
          title={t('analytics.section.referrers')}
          loading={isPending}
          empty={emptyTraffic}
          items={(data?.referrers ?? []).map((r) => ({ key: r.referrer, label: r.referrer, value: r.views }))}
        />
      </div>

      {/* Top pages */}
      <ListCard
        title={t('analytics.section.topPagesAllDocs')}
        loading={isPending}
        empty={emptyTraffic}
        rows={6}
        items={(data?.topPages ?? []).map((p) => ({
          key: `${p.project}-${p.path}`,
          label: <span className="truncate">/{p.path}</span>,
          meta: p.project,
          value: p.views,
        }))}
      />

      {/* Devices + top searches */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 font-medium text-sm">{t('analytics.section.devices')}</div>
          {isPending ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : devices.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground text-sm">{emptyTraffic}</p>
          ) : (
            <div className="-mx-2">
              {devices.map((d) => (
                <BarRow
                  key={d.device}
                  label={<span className="capitalize">{d.device}</span>}
                  fraction={d.count / totalDevices}
                  value={number(d.count)}
                />
              ))}
            </div>
          )}
        </div>

        <ListCard
          title={t('analytics.section.topSearches')}
          loading={isPending}
          empty={emptySearches}
          items={(data?.searches.topTerms ?? []).map((s) => ({
            key: s.query,
            label: <span className="font-mono text-xs">{s.query}</span>,
            value: s.count,
          }))}
        />
      </div>
    </div>
  );
}
