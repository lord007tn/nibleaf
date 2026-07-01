import { Skeleton } from '@midad/design-system/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@midad/design-system/components/ui/tabs';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Activity, BarChart3, Search, Users } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarRow } from '@/components/analytics/bar-row';
import { ListCard } from '@/components/analytics/list-card';
import { StatCard } from '@/components/analytics/stat-card';
import { useWorkspaceAnalytics } from '@/hooks/api';
import { useFormatters } from '@/lib/format';
import { useT } from '@/lib/i18n';

export const Route = createFileRoute('/app/(dashboard)/analytics')({
  component: WorkspaceAnalyticsPage,
});

function WorkspaceAnalyticsPage() {
  const t = useT();
  const { number } = useFormatters();
  const EMPTY = t('analytics.empty.traffic');
  const navigate = useNavigate();
  const [range, setRange] = useState('30d');
  const { data, isPending } = useWorkspaceAnalytics(range);

  const byProject = data?.byProject ?? [];
  const maxProjectViews = Math.max(1, ...byProject.map((p) => p.views));
  const devices = data?.devices ?? [];
  const totalDevices = Math.max(
    1,
    devices.reduce((sum, d) => sum + d.count, 0),
  );
  const projectsWithTraffic = byProject.filter((p) => p.views > 0).length;
  const hasTimeseries = (data?.timeseries ?? []).some((d) => d.views > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-3xl tracking-tight">{t('analytics.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('analytics.subtitle')}</p>
        </div>
        <Tabs onValueChange={setRange} value={range}>
          <TabsList>
            <TabsTrigger value="24h">24h</TabsTrigger>
            <TabsTrigger value="7d">7d</TabsTrigger>
            <TabsTrigger value="30d">30d</TabsTrigger>
            <TabsTrigger value="90d">90d</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t('analytics.kpi.pageViews')} value={data?.totalViews ?? 0} icon={<BarChart3 className="size-4" />} loading={isPending} />
        <StatCard
          label={t('analytics.kpi.uniqueVisitors')}
          value={data?.uniqueVisitors ?? 0}
          icon={<Users className="size-4" />}
          loading={isPending}
        />
        <StatCard label={t('analytics.kpi.searches')} value={data?.searches.total ?? 0} icon={<Search className="size-4" />} loading={isPending} />
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
            <p className="py-6 text-center text-muted-foreground text-sm">{EMPTY}</p>
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
          empty={EMPTY}
          items={(data?.referrers ?? []).map((r) => ({ key: r.referrer, label: r.referrer, value: r.views }))}
        />
      </div>

      {/* Top pages */}
      <ListCard
        title={t('analytics.section.topPagesAllDocs')}
        loading={isPending}
        empty={EMPTY}
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
            <p className="py-6 text-center text-muted-foreground text-sm">{EMPTY}</p>
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
          empty={t('analytics.empty.searches')}
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
