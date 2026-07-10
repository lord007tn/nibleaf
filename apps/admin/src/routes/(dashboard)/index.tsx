import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@nibleaf/design-system/components/ui/chart';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2, FileText, Filter, Rocket, ShieldCheck, TrendingUp, UserPlus, Users } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import { type AdminUser, useAdminFunnel, useAdminOverview, useAdminSites, useAdminUsers } from '@/hooks/api/queries';
import { fmtDate } from '@/lib/format';

export const Route = createFileRoute('/(dashboard)/')({
  component: OverviewPage,
});

const SIGNUP_DAYS = 14;

/** Bucket customer sign-ups into a per-day series for the last `SIGNUP_DAYS`. */
function buildSignupSeries(users: AdminUser[] | undefined): { date: string; signups: number }[] {
  const days: { date: string; signups: number }[] = [];
  const byDay = new Map<string, number>();
  for (const u of users ?? []) {
    const key = new Date(u.createdAt).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = SIGNUP_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    days.push({ date: key, signups: byDay.get(key) ?? 0 });
  }
  return days;
}

const chartConfig = { signups: { label: 'New customers', color: 'var(--chart-1)' } } satisfies ChartConfig;

function OverviewPage() {
  const { data, isPending } = useAdminOverview();
  const users = useAdminUsers();
  const sites = useAdminSites();
  const funnel = useAdminFunnel();

  const series = buildSignupSeries(users.data);
  const hasSignups = series.some((d) => d.signups > 0);
  const recentSites = [...(sites.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5);

  const publishedPct = data && data.deployments > 0 ? Math.round((data.publishedDeployments / data.deployments) * 100) : 0;
  const verifiedPct = data && data.users > 0 ? Math.round((data.verifiedUsers / data.users) * 100) : 0;

  const stats: { label: string; value: number | undefined; hint: string; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
    { label: 'Customers', value: data?.users, hint: `+${data?.recentUsers ?? 0} new this week`, icon: Users },
    { label: 'Sites', value: data?.sites, hint: 'Across all workspaces', icon: FileText },
    { label: 'Deployments', value: data?.deployments, hint: `${data?.publishedDeployments ?? 0} published · ${publishedPct}%`, icon: Rocket },
    { label: 'Verified customers', value: data?.verifiedUsers, hint: `${verifiedPct}% of all customers`, icon: CheckCircle2 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Overview</h1>
        <p className="mt-1 text-muted-foreground text-sm">Customer, site, and deployment health for Nibleaf Cloud.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="font-semibold text-3xl tabular-nums tracking-tight">{isPending ? '—' : (stat.value ?? 0)}</CardTitle>
              <CardAction>
                <stat.icon className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardFooter className="text-muted-foreground text-xs">{stat.hint}</CardFooter>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        {/* Sign-ups chart */}
        <Card className="@container/chart">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="size-4 text-muted-foreground" /> New customers
            </CardTitle>
            <CardDescription>Sign-ups over the last {SIGNUP_DAYS} days</CardDescription>
          </CardHeader>
          <div className="px-2 pb-4 sm:px-6">
            {users.isPending ? (
              <Skeleton className="h-[220px] w-full" />
            ) : hasSignups ? (
              <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
                <AreaChart data={series} margin={{ left: 4, right: 4, top: 8 }}>
                  <defs>
                    <linearGradient id="fillSignups" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-signups)" stopOpacity={0.7} />
                      <stop offset="95%" stopColor="var(--color-signups)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    axisLine={false}
                    dataKey="date"
                    minTickGap={24}
                    tickFormatter={(v) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    tickLine={false}
                    tickMargin={8}
                  />
                  <ChartTooltip content={<ChartTooltipContent indicator="dot" labelFormatter={(v) => fmtDate(v as string)} />} cursor={false} />
                  <Area dataKey="signups" fill="url(#fillSignups)" stroke="var(--color-signups)" strokeWidth={2} type="natural" />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="grid h-[220px] place-items-center text-center text-muted-foreground text-sm">
                <div className="flex flex-col items-center gap-2">
                  <UserPlus className="size-6 text-muted-foreground/60" />
                  No sign-ups in the last {SIGNUP_DAYS} days
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Recent sites */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-muted-foreground" /> Recent sites
            </CardTitle>
            <CardDescription>Latest documentation sites created</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {sites.isPending ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton className="h-9 w-full" key={i} />
                ))}
              </div>
            ) : recentSites.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground text-sm">No sites yet.</p>
            ) : (
              recentSites.map((site) => (
                <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50" key={site.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{site.name}</p>
                    <p className="truncate text-muted-foreground text-xs">{site.owner}</p>
                  </div>
                  <span className="shrink-0 text-muted-foreground text-xs">{fmtDate(site.createdAt)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Activation funnel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="size-4 text-muted-foreground" /> Activation funnel
          </CardTitle>
          <CardDescription>
            Last {funnel.data?.days ?? 30} days — sign-up to first successful publish (starter auto-publishes excluded)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {funnel.isPending ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton className="h-16 w-full" key={i} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {(
                [
                  { label: 'Signed up', value: funnel.data?.signups ?? 0 },
                  { label: 'Edited content', value: funnel.data?.edited ?? 0 },
                  { label: 'Clicked publish', value: funnel.data?.published ?? 0 },
                  { label: 'Publish ready', value: funnel.data?.ready ?? 0 },
                ] as const
              ).map((step) => {
                const signups = funnel.data?.signups ?? 0;
                const pct = signups > 0 ? Math.round((step.value / signups) * 100) : 0;
                return (
                  <div className="rounded-lg border border-border p-3" key={step.label}>
                    <p className="text-muted-foreground text-xs">{step.label}</p>
                    <p className="mt-1 font-semibold text-2xl tabular-nums tracking-tight">{step.value}</p>
                    <p className="text-muted-foreground text-xs">{step.label === 'Signed up' ? 'baseline' : `${pct}% of sign-ups`}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Admins</CardDescription>
            <CardTitle className="flex items-center gap-2 font-semibold text-2xl tabular-nums tracking-tight">
              <ShieldCheck className="size-4 text-muted-foreground" />
              {isPending ? '—' : (data?.admins ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Published sites</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight">
              {isPending ? '—' : (data?.publishedDeployments ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>New this week</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight">{isPending ? '—' : (data?.recentUsers ?? 0)}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Verified rate</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight">{isPending ? '—' : `${verifiedPct}%`}</CardTitle>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
