import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAnalytics } from '@/hooks/api';

export const Route = createFileRoute('/app/projects/$projectId/analytics')({
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { projectId } = Route.useParams();
  const [range, setRange] = useState('7d');
  const { data, isPending } = useAnalytics(projectId, range);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Analytics</h1>
          <p className="mt-1 text-muted-foreground text-sm">Traffic and search activity on your published site.</p>
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

      <div className="mt-6 grid grid-cols-2 gap-4">
        <StatCard label="Page views" value={data?.totalViews ?? 0} loading={isPending} />
        <StatCard label="Unique visitors" value={data?.uniqueVisitors ?? 0} loading={isPending} />
      </div>

      <div className="mt-4 rounded-xl border border-border bg-card p-5">
        <div className="mb-4 font-medium text-sm">Page views over time</div>
        {isPending ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <ResponsiveContainer height={260} width="100%">
            <AreaChart data={data?.timeseries ?? []}>
              <defs>
                <linearGradient id="views" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} tickFormatter={(d: string) => d.slice(5)} />
              <YAxis allowDecimals={false} fontSize={11} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={28} />
              <Tooltip contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }} />
              <Area dataKey="views" fill="url(#views)" stroke="var(--chart-1)" strokeWidth={2} type="monotone" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ListCard title="Top pages" empty="No page views yet." items={(data?.topPages ?? []).map((p) => ({ label: `/${p.path}`, value: p.views }))} />
        <ListCard title="Top searches" empty="No searches yet." items={(data?.topSearches ?? []).map((s) => ({ label: s.query, value: s.count }))} />
      </div>
    </div>
  );
}

function StatCard({ label, value, loading }: { label: string; value: number; loading: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="text-muted-foreground text-sm">{label}</div>
      {loading ? <Skeleton className="mt-2 h-9 w-20" /> : <div className="mt-2 font-semibold text-3xl tabular-nums tracking-tight">{value.toLocaleString()}</div>}
    </div>
  );
}

function ListCard({ title, items, empty }: { title: string; items: Array<{ label: string; value: number }>; empty: string }) {
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
              <span className="font-mono text-muted-foreground tabular-nums">{item.value}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
