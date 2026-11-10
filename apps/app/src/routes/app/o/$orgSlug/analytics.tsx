import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Activity, AlertTriangle, BarChart3, Search, Sparkles, Users } from 'lucide-react';
import { BarRow } from '@/components/analytics/bar-row';
import { compareDelta } from '@/components/analytics/insights/metrics';
import { TermsEmptyState } from '@/components/analytics/insights/search-terms';
import { ListCard } from '@/components/analytics/list-card';
import { RangeTabs } from '@/components/analytics/range-tabs';
import { STAT_GRID, StatCard } from '@/components/analytics/stat-card';
import { ViewsTimeseriesChart } from '@/components/analytics/views-timeseries-chart';
import { PageHeader } from '@/components/app/page-header';
import { useCurrentOrganization } from '@/components/organization/organization-context';
import { QueryErrorState } from '@/components/query-error-state';
import type { AnalyticsRange } from '@/hooks/api';
// Loader factories come from the i18n-free modules: loaders ship in every page's first load.
import { analyticsTimezone } from '@/hooks/api/analytics/query-options';
import { organizationAnalyticsQueryOptions } from '@/hooks/api/organization-query-options';
import { useOrganizationAnalytics } from '@/hooks/api/organizations';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { useFormatters } from '@/lib/format';

/** Device buckets emitted by the server (`deviceFromUserAgent`); unknown values fall back to the raw bucket. */
const DEVICE_KEYS: Record<string, MessageKey> = {
  desktop: 'analytics.device.desktop',
  mobile: 'analytics.device.mobile',
  tablet: 'analytics.device.tablet',
  unknown: 'analytics.device.unknown',
};

import { organizationKeys } from '@/hooks/api/organization-keys';
import { AnalyticsProvider, useAnalyticsFilters } from '@/providers/analytics-provider';

const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = '30d';

export const Route = createFileRoute('/app/o/$orgSlug/analytics')({
  // Same range and timezone as the page's first render (AnalyticsProvider below).
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    const organization = queryClient.getQueryData<{ id: string }>(organizationKeys.organizations.bySlug(orgSlug));
    if (organization)
      prefetchRouteData(queryClient, organizationAnalyticsQueryOptions(organization.id, DEFAULT_ANALYTICS_RANGE, analyticsTimezone()));
  },
  component: WorkspaceAnalyticsRoute,
});

function WorkspaceAnalyticsRoute() {
  return (
    <AnalyticsProvider defaultRange={DEFAULT_ANALYTICS_RANGE}>
      <WorkspaceAnalyticsPage />
    </AnalyticsProvider>
  );
}

function WorkspaceAnalyticsPage() {
  const t = useT();
  const { number, usd } = useFormatters();
  const EMPTY = t('analytics.empty.traffic');
  const navigate = useNavigate();
  const { range, setRange, timezone } = useAnalyticsFilters();
  // Today's cross-site analytics, limited to this organization's websites you can open (§5.1).
  const organization = useCurrentOrganization();
  const { data, isPending, isError, isFetching, refetch } = useOrganizationAnalytics(organization.id, range, timezone);
  const unavailable = isError || data?.availability === 'unavailable';
  const partial = data?.availability === 'partial';
  const emptyTraffic = unavailable ? t('analytics.state.unknown') : EMPTY;
  const emptySearches = unavailable ? t('analytics.state.unknown') : t('analytics.empty.searches');

  const byProject = data?.byProject ?? [];
  const maxProjectViews = Math.max(1, ...byProject.map((p) => p.views));
  const devices = data?.devices ?? [];
  const deviceLabel = (device: string) => {
    const key = DEVICE_KEYS[device];
    return key ? t(key) : device;
  };
  const totalDevices = Math.max(
    1,
    devices.reduce((sum, d) => sum + d.count, 0),
  );
  const sitesWithTraffic = unavailable ? null : byProject.filter((p) => p.views > 0).length;
  // Against the equal window right before this one; hidden when either side isn't known.
  const viewsDelta = unavailable
    ? null
    : compareDelta({ value: data?.comparableTotalViews ?? null, previous: data?.previousTotalViews ?? null }, 'count');
  // The workspace roll-up never lists search terms when they're redacted (each site's Search
  // report applies its own privacy settings), so an empty list with searches isn't "no searches".
  const searchTotal = data?.searches.total ?? 0;
  const termsHidden = !unavailable && searchTotal > 0 && (data?.searches.topTerms ?? []).length === 0;
  const costMicros = data?.ai.costMicros ?? null;
  const zeroResults = data?.searches && 'zeroResults' in data.searches ? data.searches.zeroResults : null;
  const clickedResults = data?.searches && 'clickedResults' in data.searches ? data.searches.clickedResults : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader actions={<RangeTabs onValueChange={setRange} value={range} />} description={t('analytics.subtitle')} title={t('analytics.title')} />

      {/* A failed request and an analytics outage (a successful response saying "unavailable") both retry in place. */}
      {isError ? <QueryErrorState onRetry={() => void refetch()} retrying={isFetching} /> : null}
      {unavailable && !isError ? (
        <QueryErrorState
          description={t('analytics.state.unavailable.body')}
          onRetry={() => void refetch()}
          retrying={isFetching}
          title={t('analytics.state.unavailable.title')}
        />
      ) : null}
      {partial ? (
        <Alert variant="info">
          <AlertTriangle />
          <AlertTitle>{t('analytics.state.partial.title')}</AlertTitle>
          <AlertDescription>{t('analytics.state.partial.body')}</AlertDescription>
        </Alert>
      ) : null}

      {/* KPIs */}
      <div className={STAT_GRID}>
        <StatCard
          label={t('analytics.kpi.pageViews')}
          value={unavailable ? null : (data?.totalViews ?? null)}
          icon={<BarChart3 className="size-4" />}
          delta={viewsDelta}
          hint={viewsDelta ? t('analytics.vsPrevious') : undefined}
          loading={isPending}
        />
        <StatCard
          label={t('analytics.kpi.uniqueVisitors')}
          value={data?.uniqueVisitors ?? null}
          icon={<Users className="size-4" />}
          loading={isPending}
        />
        <StatCard label={t('analytics.kpi.searches')} value={data?.searches.total ?? null} icon={<Search className="size-4" />} loading={isPending} />
        <StatCard label={t('analytics.kpi.sitesWithTraffic')} value={sitesWithTraffic} icon={<Activity className="size-4" />} loading={isPending} />
      </div>

      {/* Pageviews chart */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 font-medium text-sm">{t('analytics.chart.pageviewsAllSites')}</div>
        <ViewsTimeseriesChart data={data?.timeseries ?? []} loading={isPending} unknown={unavailable} />
      </div>

      <div className={STAT_GRID}>
        <StatCard label={t('analytics.kpi.zeroResults')} value={zeroResults ?? null} icon={<Search className="size-4" />} loading={isPending} />
        <StatCard label={t('analytics.kpi.resultClicks')} value={clickedResults ?? null} icon={<Search className="size-4" />} loading={isPending} />
        <StatCard
          label={t('analytics.kpi.answersCompleted')}
          value={data?.ai.answersCompleted ?? null}
          icon={<Sparkles className="size-4" />}
          loading={isPending}
        />
        <StatCard
          label={t('dashboard.ai.cost')}
          value={costMicros}
          display={costMicros === null ? undefined : usd(costMicros / 1_000_000)}
          icon={<Sparkles className="size-4" />}
          loading={isPending}
        />
      </div>

      <p className="text-muted-foreground text-xs">{t('analytics.privacy.queryTerms')}</p>

      {/* By project + referrers */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 font-medium text-sm">{t('analytics.section.bySite')}</div>
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
          items={(data?.referrers ?? []).map((r) => ({ key: r.referrer, label: <span dir="ltr">{r.referrer}</span>, value: r.views }))}
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
          label: (
            <span className="truncate" dir="ltr">
              /{p.path}
            </span>
          ),
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
                <BarRow key={d.device} label={deviceLabel(d.device)} fraction={d.count / totalDevices} value={number(d.count)} />
              ))}
            </div>
          )}
        </div>

        {termsHidden ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="mb-3 font-medium text-sm">{t('analytics.section.topSearches')}</div>
            <TermsEmptyState reason={t('analytics.workspace.termsPerSite')} />
          </div>
        ) : (
          <ListCard
            title={t('analytics.section.topSearches')}
            loading={isPending}
            empty={emptySearches}
            items={(data?.searches.topTerms ?? []).map((s) => ({
              key: s.query,
              label: (
                <span className="font-mono text-xs" dir="auto">
                  {s.query}
                </span>
              ),
              value: s.count,
            }))}
          />
        )}
      </div>
    </div>
  );
}
