import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@nibleaf/design-system/components/ui/chart';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Activity, CheckCircle2, FileText, Filter, Globe2, Rocket, ShieldCheck, TrendingUp, TriangleAlert, UserPlus, Users } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts';
import { DataError } from '@/components/data-state';
import { type AdminUser, useAdminFunnel, useAdminOverview, useAdminSites, useAdminUsers } from '@/hooks/api/queries';
import { useFormatters } from '@/lib/format';

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

function OverviewPage() {
  const t = useT();
  const format = useFormatters();
  const overview = useAdminOverview();
  const { data, isPending } = overview;
  const users = useAdminUsers();
  const sites = useAdminSites();
  const funnel = useAdminFunnel();

  const series = buildSignupSeries(users.data);
  const hasSignups = series.some((d) => d.signups > 0);
  const recentSites = [...(sites.data ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5);

  const publishedPct = data && data.deployments > 0 ? Math.round((data.publishedDeployments / data.deployments) * 100) : 0;
  const verifiedPct = data && data.users > 0 ? Math.round((data.verifiedUsers / data.users) * 100) : 0;
  const attentionCount =
    (data?.failedDeployments24h ?? 0) +
    (data?.domainIssues ?? 0) +
    (data?.takenDownSites ?? 0) +
    (data?.expiredOwnerInvites ?? 0) +
    (data?.failedExports7d ?? 0) +
    (data?.gitIssues ?? 0);

  const chartConfig = { signups: { label: t('admin.overview.newCustomers'), color: 'var(--chart-1)' } } satisfies ChartConfig;
  const stats: { label: string; value: number | undefined; hint: string; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
    {
      label: t('admin.nav.customers'),
      value: data?.users,
      hint: t('admin.overview.newThisWeekCount', { count: format.number(data?.recentUsers ?? 0) }),
      icon: Users,
    },
    { label: t('nav.sites'), value: data?.sites, hint: t('admin.overview.allWorkspaces'), icon: FileText },
    {
      label: t('admin.overview.deployments'),
      value: data?.deployments,
      hint: t('admin.overview.readyPercent', { count: format.number(data?.publishedDeployments ?? 0), percent: format.percent(publishedPct) }),
      icon: Rocket,
    },
    {
      label: t('admin.overview.verifiedCustomers'),
      value: data?.verifiedUsers,
      hint: t('admin.overview.customerPercent', { percent: format.percent(verifiedPct) }),
      icon: CheckCircle2,
    },
  ];

  if (overview.isError || users.isError || sites.isError || funnel.isError) {
    return (
      <DataError
        message={t('admin.overview.loadError')}
        retry={() => void Promise.all([overview.refetch(), users.refetch(), sites.refetch(), funnel.refetch()])}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">{t('nav.overview')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('admin.overview.subtitle')}</p>
      </div>

      <Card className={attentionCount > 0 ? 'border-destructive/40' : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            {attentionCount > 0 ? <TriangleAlert className="size-4 text-destructive" /> : <Activity className="size-4 text-muted-foreground" />}
            {t('admin.overview.attention')}
          </CardTitle>
          <CardDescription>
            {isPending
              ? t('admin.overview.loadingSignals')
              : attentionCount > 0
                ? t('admin.overview.attentionBody', { count: format.number(attentionCount) })
                : t('admin.overview.noSignals')}
          </CardDescription>
          <CardAction>
            <Button nativeButton={false} render={<Link to="/operations" />} size="sm" variant="outline">
              {t('admin.overview.openOperations')}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            [t('admin.overview.deployFailures'), data?.failedDeployments24h ?? 0],
            [t('admin.overview.domainErrors'), data?.domainIssues ?? 0],
            [t('admin.overview.takenDown'), data?.takenDownSites ?? 0],
            [t('admin.overview.expiredInvites'), data?.expiredOwnerInvites ?? 0],
            [t('admin.overview.exportFailures'), data?.failedExports7d ?? 0],
            [t('admin.overview.gitIssues'), data?.gitIssues ?? 0],
          ].map(([label, value]) => (
            <div className="rounded-lg border p-3" key={String(label)}>
              <p className="text-muted-foreground text-xs">{label}</p>
              <p className="mt-1 font-semibold text-xl tabular-nums">{isPending ? '—' : format.number(Number(value))}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="font-semibold text-3xl tabular-nums tracking-tight">{isPending ? '—' : format.number(stat.value ?? 0)}</CardTitle>
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
              <TrendingUp className="size-4 text-muted-foreground" /> {t('admin.overview.newCustomers')}
            </CardTitle>
            <CardDescription>{t('admin.overview.signupsPeriod', { days: format.number(SIGNUP_DAYS) })}</CardDescription>
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
                    tickFormatter={(value) => format.shortDate(String(value))}
                    tickLine={false}
                    tickMargin={8}
                  />
                  <ChartTooltip
                    content={<ChartTooltipContent indicator="dot" labelFormatter={(value) => format.date(String(value))} />}
                    cursor={false}
                  />
                  <Area dataKey="signups" fill="url(#fillSignups)" stroke="var(--color-signups)" strokeWidth={2} type="natural" />
                </AreaChart>
              </ChartContainer>
            ) : (
              <div className="grid h-[220px] place-items-center text-center text-muted-foreground text-sm">
                <div className="flex flex-col items-center gap-2">
                  <UserPlus className="size-6 text-muted-foreground/60" />
                  {t('admin.overview.noSignups', { days: format.number(SIGNUP_DAYS) })}
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Recent sites */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="size-4 text-muted-foreground" /> {t('admin.overview.recentSites')}
            </CardTitle>
            <CardDescription>{t('admin.overview.recentSitesBody')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {sites.isPending ? (
              <div className="space-y-2">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton className="h-9 w-full" key={i} />
                ))}
              </div>
            ) : recentSites.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground text-sm">{t('admin.overview.noSites')}</p>
            ) : (
              recentSites.map((site) => (
                <div className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50" key={site.id}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">{site.name}</p>
                    <p className="truncate text-muted-foreground text-xs">{site.owner}</p>
                  </div>
                  <span className="shrink-0 text-muted-foreground text-xs">{format.date(site.createdAt)}</span>
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
            <Filter className="size-4 text-muted-foreground" /> {t('admin.overview.activationFunnel')}
          </CardTitle>
          <CardDescription>{t('admin.overview.activationBody', { days: format.number(funnel.data?.days ?? 30) })}</CardDescription>
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
                  { label: t('admin.overview.signedUp'), value: funnel.data?.signups ?? 0, baseline: true },
                  { label: t('admin.overview.editedContent'), value: funnel.data?.edited ?? 0, baseline: false },
                  { label: t('admin.overview.clickedPublish'), value: funnel.data?.published ?? 0, baseline: false },
                  { label: t('admin.overview.publishReady'), value: funnel.data?.ready ?? 0, baseline: false },
                ] as const
              ).map((step) => {
                const signups = funnel.data?.signups ?? 0;
                const pct = signups > 0 ? Math.round((step.value / signups) * 100) : 0;
                return (
                  <div className="rounded-lg border border-border p-3" key={step.label}>
                    <p className="text-muted-foreground text-xs">{step.label}</p>
                    <p className="mt-1 font-semibold text-2xl tabular-nums tracking-tight">{format.number(step.value)}</p>
                    <p className="text-muted-foreground text-xs">
                      {step.baseline ? t('admin.overview.baseline') : t('admin.overview.signupPercent', { percent: format.percent(pct) })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
          {funnel.isSuccess ? (
            <p className="mt-4 text-muted-foreground text-xs">
              {funnel.data?.medianHoursToReady == null
                ? t('admin.overview.noConversion')
                : t('admin.overview.medianPublish', {
                    hours: format.number(funnel.data.medianHoursToReady),
                    count: format.number(funnel.data.readyWithin24Hours),
                  })}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Secondary stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.overview.admins')}</CardDescription>
            <CardTitle className="flex items-center gap-2 font-semibold text-2xl tabular-nums tracking-tight">
              <ShieldCheck className="size-4 text-muted-foreground" />
              {isPending ? '—' : format.number(data?.admins ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.overview.readyDeployments')}</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight">
              {isPending ? '—' : format.number(data?.publishedDeployments ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.overview.healthyDomains')}</CardDescription>
            <CardTitle className="flex items-center gap-2 font-semibold text-2xl tabular-nums tracking-tight">
              <Globe2 className="size-4 text-muted-foreground" />
              {isPending ? '—' : `${format.number(data?.healthyDomains ?? 0)}/${format.number(data?.domains ?? 0)}`}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.overview.newThisWeek')}</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight">
              {isPending ? '—' : format.number(data?.recentUsers ?? 0)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>{t('admin.overview.verifiedRate')}</CardDescription>
            <CardTitle className="font-semibold text-2xl tabular-nums tracking-tight">{isPending ? '—' : format.percent(verifiedPct)}</CardTitle>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
}
