import { Link } from '@tanstack/react-router';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { useWorkspaceAnalytics } from '@/hooks/api';

/** Compact workspace-traffic sidebar: headline total, bar chart, top pages. */
export function TrafficPanel() {
  const { data, isPending } = useWorkspaceAnalytics('30d');
  const series = (data?.timeseries ?? []).slice(-14);
  const topPages = (data?.topPages ?? []).slice(0, 5);
  const maxViews = Math.max(1, ...topPages.map((p) => p.views));
  const hasTraffic = (data?.totalViews ?? 0) > 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm">Traffic</h2>
        <span className="font-mono text-muted-foreground text-xs">last 14 days</span>
      </div>

      {isPending ? (
        <Skeleton className="mt-4 h-7 w-24" />
      ) : (
        <div className="mt-3 font-semibold text-2xl tabular-nums tracking-tight">{(data?.totalViews ?? 0).toLocaleString()}</div>
      )}
      <div className="text-muted-foreground text-xs">pageviews across all docs</div>

      <div className="mt-4 h-[90px]">
        {isPending ? (
          <Skeleton className="h-full w-full" />
        ) : hasTraffic ? (
          <ResponsiveContainer height="100%" width="100%">
            <BarChart data={series} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <Tooltip
                cursor={{ fill: 'var(--muted)' }}
                contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }}
                labelFormatter={(d) => (typeof d === 'string' ? d.slice(5) : d)}
              />
              <Bar dataKey="views" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="grid h-full place-items-center text-center text-muted-foreground text-xs">No traffic yet.</div>
        )}
      </div>

      <div className="mt-4 border-border border-t pt-4">
        <div className="mb-3 font-medium text-sm">Top pages</div>
        {isPending ? (
          <div className="space-y-2.5">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        ) : topPages.length === 0 ? (
          <p className="text-muted-foreground text-xs">No traffic yet — publish a site and share it.</p>
        ) : (
          <ul className="space-y-2.5">
            {topPages.map((page) => (
              <li key={`${page.project}-${page.path}`} className="flex items-center gap-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-foreground/80 text-xs">/{page.path}</span>
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-[var(--chart-1)]" style={{ width: `${Math.max(4, Math.round((page.views / maxViews) * 100))}%` }} />
                </span>
                <span className="w-10 shrink-0 text-end font-mono text-muted-foreground text-xs tabular-nums">{page.views}</span>
              </li>
            ))}
          </ul>
        )}
        <Link to="/app/analytics" className="mt-4 block text-[var(--chart-1)] text-xs hover:underline">
          View all analytics →
        </Link>
      </div>
    </div>
  );
}
