import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowRight,
  BarChart3,
  Check,
  Copy,
  CreditCard,
  Eye,
  FileText,
  Globe2,
  Link2Off,
  type LucideIcon,
  PenLine,
  Plug,
  Rocket,
  Settings as SettingsIcon,
  SpellCheck,
  TriangleAlert,
  Users,
  X,
} from 'lucide-react';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { compareDelta } from '@/components/analytics/insights/metrics';
import { STAT_GRID, StatCard } from '@/components/analytics/stat-card';
import { ViewsAreaChart } from '@/components/analytics/views-area-chart';
import { InlineSkeleton } from '@/components/inline-skeleton';
import { ViewOnlyBanner } from '@/components/project/view-only-notice';
import { QueryErrorState } from '@/components/query-error-state';
import { PageStatusBadge, PendingChangesNotice } from '@/features/publish/components/pending-changes';
import { pageLiveStatus } from '@/features/publish/model/pending';
import { recentPages, siteOverview } from '@/features/site-overview/model/overview';
import type { AnalyticsRange, Deployment } from '@/hooks/api';
import {
  friendlyErrorMessage,
  pickLiveDomain,
  useDeployments,
  useDomains,
  usePages,
  usePendingChanges,
  useProject,
  useProjectMembers,
  usePublishAnyway,
} from '@/hooks/api';
import { useProjectAnalytics } from '@/hooks/api/analytics';
import { analyticsTimezone, projectAnalyticsQueryOptions } from '@/hooks/api/analytics/query-options';
import { domainsQueryOptions, projectMembersQueryOptions } from '@/hooks/api/query-options';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { isolate } from '@/lib/bidi';
import { deploymentStatusLabel, deploymentStatusVariant } from '@/lib/deployment-status';
import { useFormatters } from '@/lib/format';
import { copyToClipboard } from '@/lib/invitations';
import type { SiteAdminState } from '@/lib/project-settings-access';
import { canonicalSiteBase } from '@/lib/site-seo';

const DEFAULT_ANALYTICS_RANGE: AnalyticsRange = '30d';

export const Route = createFileRoute('/app/projects/$projectId/')({
  // The site layout's loader already starts the site, pages and publishes; add
  // what only the overview shows (team size, live address).
  loader: ({ context: { queryClient }, params: { projectId } }) => {
    prefetchRouteData(queryClient, projectMembersQueryOptions(projectId));
    prefetchRouteData(queryClient, domainsQueryOptions(projectId));
    prefetchRouteData(queryClient, projectAnalyticsQueryOptions(projectId, DEFAULT_ANALYTICS_RANGE, analyticsTimezone()));
  },
  component: SiteOverviewPage,
});

const ACTIVITY_SKELETON_ROWS = ['a', 'b', 'c'];
const RECENT_PAGE_SKELETON_ROWS = ['a', 'b', 'c', 'd'];

/** Per-site dashboard: the hub each site opens to (stats, traffic, recent pages,
 *  and quick links). The full-page editor lives at /editor. */
function SiteOverviewPage() {
  const { projectId } = Route.useParams();
  const t = useT();
  const { date } = useFormatters();
  const [range, setRange] = useState<AnalyticsRange>(DEFAULT_ANALYTICS_RANGE);
  const { data: project, isPending: projectPending } = useProject(projectId);
  const pagesQuery = usePages(projectId);
  const { data: pages, isPending: pagesPending } = pagesQuery;
  const membersQuery = useProjectMembers(projectId);
  const { data: members, isPending: membersPending } = membersQuery;
  const deploymentsQuery = useDeployments(projectId);
  const { data: deployments, isPending: deploymentsPending } = deploymentsQuery;
  const { data: domains } = useDomains(projectId);
  // Domain settings are for Admins; while that's unknown, show neither variant.
  const { status: settingsAccess, edit: editAccess } = useProjectAdminStatus(projectId);
  // Viewers read the site: they open the pages to read, and nothing here offers them a publish.
  const viewOnly = editAccess === 'viewOnly';
  const analyticsQuery = useProjectAnalytics(projectId, range);
  const { data: analytics, isPending: analyticsPending, isError: analyticsError } = analyticsQuery;
  // The same check the top bar's Publish count reads: what the live site is missing.
  const { data: pendingChanges } = usePendingChanges(projectId);

  const overview = siteOverview({
    project,
    projectPending,
    pages,
    pagesError: pagesQuery.isError,
    members,
    membersError: membersQuery.isError,
    deployments,
    deploymentsPending,
    deploymentsError: deploymentsQuery.isError,
    domains,
    analytics,
    analyticsError,
    viewOnly,
  });
  const { pagesFailed, membersFailed, deploymentsFailed, latestDeployment, failedDeployment, liveDomain, connectingDomain, analyticsUnknown } =
    overview;
  const canManageSettings = settingsAccess === 'admin';
  // The publish dialog uses this same resolver, including its internal URL fallback.
  const liveHref = canonicalSiteBase(projectId, { slug: project?.slug, primaryDomain: liveDomain });
  // Against the equal window right before this one; hidden when either side isn't known.
  const viewsDelta = overview.viewsComparison ? compareDelta(overview.viewsComparison, 'count') : null;
  const recent = useMemo(() => recentPages(pages), [pages]);

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:px-6 sm:py-8 xl:px-10">
      {/* One announcement for the page; the regions still loading are only marked aria-busy. */}
      {projectPending || deploymentsPending || pagesPending ? (
        <p className="sr-only" role="status">
          {t('common.loading')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* The site name, not a generic "Overview" that flips to the name a moment later. */}
          <h1 className="font-semibold text-2xl tracking-tight">
            {projectPending ? (
              <>
                <span className="sr-only">{t('overview.title')}</span>
                <InlineSkeleton className="h-8 w-48" />
              </>
            ) : (
              (project?.name ?? t('overview.title'))
            )}
          </h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('overview.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Before the first publish there's nothing live to visit, so offer the
              draft preview instead of a link to an empty site. */}
          {overview.publishing === 'live' ? (
            <Button
              nativeButton={false}
              render={<a href={liveHref} target="_blank" rel="noreferrer" aria-label={t('overview.viewSite')} />}
              size="sm"
              variant="outline"
            >
              <Eye className="size-3.5" /> {t('overview.viewSite')}
            </Button>
          ) : overview.publishing === 'neverPublished' ? (
            <Button
              nativeButton={false}
              render={<Link aria-label={t('project.previewDraftAria')} params={{ projectId }} to="/app/projects/$projectId/preview" />}
              size="sm"
              variant="outline"
            >
              <Eye className="size-3.5" /> {t('project.preview')}
            </Button>
          ) : null}
          <Button nativeButton={false} render={<Link params={{ projectId }} to="/app/projects/$projectId/editor" />} size="sm">
            {viewOnly ? <FileText className="size-3.5" /> : <PenLine className="size-3.5" />}{' '}
            {viewOnly ? t('overview.viewPages') : t('overview.openEditor')}
          </Button>
        </div>
      </div>
      {viewOnly ? <ViewOnlyBanner className="mt-5 rounded-lg border" /> : null}

      {/* Publish-failure triage: what blocked the last publish, with per-page
          links into the editor and a grammar-only "Publish anyway" escape hatch. */}
      {failedDeployment ? <PublishFailureCard deployment={failedDeployment} pages={pages ?? []} projectId={projectId} viewOnly={viewOnly} /> : null}

      {/* First-publish nudge: shown until the site has one READY deployment.
          Hidden while the latest attempt is FAILED (the failure card leads). */}
      {overview.showFirstPublishNudge ? (
        <PublishNudge
          projectId={projectId}
          settingsAccess={settingsAccess}
          permissionError={
            membersFailed ? (
              <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs">
                <span>{t('overview.nudge.permissionsError')}</span>
                <Button
                  className="h-auto px-0 py-0 text-xs underline pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                  loading={membersQuery.isFetching}
                  onClick={() => void membersQuery.refetch()}
                  size="xs"
                  type="button"
                  variant="link"
                >
                  {t('error.tryAgain')}
                </Button>
              </p>
            ) : undefined
          }
        />
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <div className="min-w-0 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Globe2 className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-sm">{t('overview.live.title')}</div>
              {overview.liveCard === 'live' ? (
                <>
                  {/* An address reads left to right and loses its end, not its "https://", when it is too long, in an RTL page too. */}
                  <a
                    className="block truncate text-left font-mono text-primary text-sm hover:underline rtl:text-right"
                    dir="ltr"
                    href={liveHref}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {liveDomain ?? liveHref}
                  </a>
                  {connectingDomain ? (
                    <p className="mt-1 break-words text-muted-foreground text-xs">
                      {t('overview.live.domainConnecting', { domain: isolate(connectingDomain) })}
                      {settingsAccess === 'admin' ? (
                        <>
                          {' '}
                          <Link
                            className="font-medium text-primary hover:underline"
                            params={{ projectId }}
                            search={{ section: 'domain' }}
                            to="/app/projects/$projectId/settings"
                          >
                            {t('overview.live.finishSetup')}
                          </Link>
                        </>
                      ) : settingsAccess === 'notAdmin' ? (
                        ` ${t('overview.live.askAdmin')}`
                      ) : null}
                    </p>
                  ) : null}
                </>
              ) : overview.liveCard === 'loading' ? (
                <Skeleton className="mt-1 h-4 w-40" />
              ) : overview.liveCard === 'loadError' ? (
                <p className="text-muted-foreground text-sm">{t('overview.live.loadError')}</p>
              ) : (
                <>
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 break-words text-muted-foreground text-sm">{t('overview.live.willBeLiveAt', { url: isolate(liveHref) })}</p>
                    <Button
                      aria-label={t('deploy.copyAddress')}
                      className="shrink-0 pointer-coarse:min-h-11 pointer-coarse:min-w-11"
                      onClick={async () => {
                        if (await copyToClipboard(liveHref)) toast.success(t('settings.apiKeys.urlCopied'));
                        else toast.error(t('settings.members.copyFailed'));
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Copy aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {t('overview.live.availableAfterPublish')}{' '}
                    <Link
                      className="font-medium text-primary hover:underline"
                      params={{ projectId }}
                      search={{ publish: true }}
                      to="/app/projects/$projectId/editor"
                    >
                      {t('project.publish')}
                    </Link>
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="font-semibold text-sm">{t('overview.activity.title')}</h2>
            <div className="flex items-center gap-3">
              {latestDeployment ? (
                <Badge variant={deploymentStatusVariant(latestDeployment.status)}>{deploymentStatusLabel(latestDeployment.status, t)}</Badge>
              ) : null}
              {/* The full history: every publish, what each changed, and Restore. */}
              <Link
                className="text-primary text-xs hover:underline"
                data-testid="activity-view-all"
                params={{ projectId }}
                to="/app/projects/$projectId/publishes"
              >
                {t('overview.activity.viewAll')}
              </Link>
            </div>
          </div>
          <PendingChangesNotice className="mb-3" projectId={projectId} viewOnly={viewOnly} />
          <div aria-busy={deploymentsPending || undefined} className="flex flex-col gap-2">
            {deploymentsPending ? (
              <>
                {/* Shaped like an activity line: version, message, date. */}
                {ACTIVITY_SKELETON_ROWS.map((row) => (
                  <div aria-hidden className="flex h-5 items-center justify-between gap-3" key={row}>
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Skeleton className="h-4 w-8 shrink-0" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                    <Skeleton className="h-3 w-16 shrink-0" />
                  </div>
                ))}
              </>
            ) : null}
            {deploymentsFailed ? <QueryErrorState onRetry={() => void deploymentsQuery.refetch()} retrying={deploymentsQuery.isFetching} /> : null}
            {(deployments ?? []).slice(0, 3).map((deployment) => (
              // Each line opens that version: what it changed, and Restore.
              <Link
                className="-mx-1.5 flex items-center justify-between gap-3 rounded-md px-1.5 text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
                data-testid="activity-row"
                key={deployment.id}
                params={{ projectId, deploymentId: deployment.id }}
                to="/app/projects/$projectId/publishes/$deploymentId"
              >
                {/* The version tag is code (always LTR); commit messages are free
                    text in whatever language the author wrote, so they resolve
                    their own direction and truncate on their own end. */}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="shrink-0 font-medium" dir="ltr">
                    v{deployment.version}
                  </span>
                  {/* Only a publish that went live reads "Published docs"; a failed or
                      in-flight attempt says so. */}
                  {deployment.status === 'READY' ? null : (
                    <Badge className="shrink-0" variant={deploymentStatusVariant(deployment.status)}>
                      {deploymentStatusLabel(deployment.status, t)}
                    </Badge>
                  )}
                  {deployment.commitMessage || deployment.status === 'READY' ? (
                    <span className="min-w-0 truncate text-muted-foreground" dir="auto">
                      {deployment.commitMessage || t('overview.activity.publish')}
                    </span>
                  ) : null}
                </div>
                <span className="shrink-0 text-muted-foreground text-xs">{date(deployment.completedAt ?? deployment.createdAt)}</span>
              </Link>
            ))}
            {deployments && deployments.length === 0 ? <p className="text-muted-foreground text-sm">{t('overview.activity.empty')}</p> : null}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className={cn('mt-6', STAT_GRID)}>
        <StatCard
          label={t('overview.stats.pages')}
          value={overview.pageCount}
          icon={<FileText className="size-4" />}
          link={<Link className={TILE_LINK} aria-label={t('overview.stats.pages')} params={{ projectId }} to="/app/projects/$projectId/editor" />}
          loading={pagesPending && !pagesFailed}
        />
        <StatCard
          label={t('overview.stats.members')}
          value={overview.memberCount}
          icon={<Users className="size-4" />}
          link={
            <Link
              className={TILE_LINK}
              aria-label={t('overview.stats.members')}
              params={{ projectId }}
              search={{ section: 'members' }}
              to="/app/projects/$projectId/settings"
            />
          }
          loading={membersPending && !membersFailed}
        />
        <StatCard
          label={t('overview.stats.deploys')}
          value={overview.publishCount}
          icon={<Rocket className="size-4" />}
          link={
            <Link className={TILE_LINK} aria-label={t('overview.stats.deploys')} params={{ projectId }} to="/app/projects/$projectId/publishes" />
          }
          loading={projectPending}
        />
        <StatCard
          label={t('overview.stats.pageviews')}
          value={overview.totalViews}
          icon={<BarChart3 className="size-4" />}
          delta={viewsDelta}
          hint={viewsDelta ? t('analytics.vsPrevious') : undefined}
          link={
            <Link className={TILE_LINK} aria-label={t('overview.stats.pageviews')} params={{ projectId }} to="/app/projects/$projectId/analytics" />
          }
          loading={analyticsPending}
          refreshing={analyticsQuery.isPlaceholderData}
        />
      </div>

      {/* Traffic chart */}
      <div className="mt-6 flex flex-col gap-4">
        {/* A failed request and an analytics outage (a successful "unavailable" response) both retry in place. */}
        {analyticsUnknown ? (
          <QueryErrorState
            description={analyticsError ? undefined : t('analytics.state.unavailable.body')}
            onRetry={() => void analyticsQuery.refetch()}
            retrying={analyticsQuery.isFetching}
            title={analyticsError ? undefined : t('analytics.state.unavailable.title')}
          />
        ) : null}
        <ViewsAreaChart
          title={t('overview.viewsTitle')}
          description={t('overview.viewsDesc')}
          data={analytics?.timeseries ?? []}
          range={range}
          onRangeChange={setRange}
          loading={analyticsPending}
          refreshing={analyticsQuery.isPlaceholderData}
          unavailable={analyticsUnknown}
          // "Publish a site and share it" reads wrong once the site is live.
          empty={overview.publishing === 'live' ? t('overview.viewsEmptyLive') : undefined}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Recent pages */}
        <div className="min-w-0 rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-border border-b px-5 py-3.5">
            <h2 className="font-semibold text-sm">{t('overview.recentPages')}</h2>
            <Link
              className="flex items-center gap-1 text-primary text-xs hover:underline"
              params={{ projectId }}
              to="/app/projects/$projectId/editor"
            >
              {viewOnly ? t('overview.viewPages') : t('overview.openEditor')} <ArrowRight className="size-3 rtl:-scale-x-100" />
            </Link>
          </div>
          {pagesFailed ? (
            <div className="p-4">
              <QueryErrorState onRetry={() => void pagesQuery.refetch()} retrying={pagesQuery.isFetching} />
            </div>
          ) : pagesPending ? (
            <div aria-busy="true">
              <Table aria-hidden>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('overview.col.page')}</TableHead>
                    <TableHead>{t('overview.col.status')}</TableHead>
                    <TableHead className="text-end">{t('overview.col.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Shaped like a recent-page row: icon and title, status, then the date. */}
                  {RECENT_PAGE_SKELETON_ROWS.map((row) => (
                    <TableRow key={row}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                          <Skeleton className="h-4 w-1/2" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-14" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="ms-auto h-3 w-16" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : recent.length === 0 ? (
            <p className="px-5 py-8 text-center text-muted-foreground text-sm">{t('overview.noPages')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('overview.col.page')}</TableHead>
                  <TableHead>{t('overview.col.status')}</TableHead>
                  <TableHead className="text-end">{t('overview.col.updated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((page) => {
                  const status = pageLiveStatus(page.id, pendingChanges);
                  return (
                    <TableRow key={page.id} className="relative">
                      <TableCell>
                        {/* A real link to this page in the editor: keyboard, middle-click and
                          screen readers all work, and the whole row stays clickable. */}
                        <Link
                          className="flex items-center gap-2.5 rounded-sm outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                          params={{ projectId }}
                          search={{ page: page.id }}
                          to="/app/projects/$projectId/editor"
                        >
                          <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                          {/* The icon stays on the interface's side; the title takes its own direction and
                              alignment, so an Arabic title sits right in an English table (AUTH-39). */}
                          <span className="min-w-0 flex-1 truncate text-start font-medium" dir="auto">
                            {page.config?.sidebarTitle?.trim() || page.title}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>{status ? <PageStatusBadge status={status} /> : null}</TableCell>
                      <TableCell className="text-end text-muted-foreground text-xs">{date(page.updatedAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Manage quick links */}
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold text-sm">{t('overview.manage')}</h2>
          <ManageRow icon={BarChart3} title={t('overview.link.analytics')} desc={t('overview.link.analyticsDesc')}>
            <Link
              aria-label={t('overview.link.analytics')}
              className="absolute inset-0 rounded-xl"
              params={{ projectId }}
              to="/app/projects/$projectId/analytics"
            />
          </ManageRow>
          <ManageRow icon={Users} title={t('overview.link.members')} desc={t('overview.link.membersDesc')}>
            <Link
              aria-label={t('overview.link.members')}
              className="absolute inset-0 rounded-xl"
              params={{ projectId }}
              search={{ section: 'members' }}
              to="/app/projects/$projectId/settings"
            />
          </ManageRow>
          {membersFailed ? (
            <QueryErrorState onRetry={() => void membersQuery.refetch()} retrying={membersQuery.isFetching} />
          ) : settingsAccess === 'pending' ? (
            <div aria-busy="true" className="space-y-3">
              <Skeleton aria-hidden className="h-20 w-full rounded-xl" />
              <Skeleton aria-hidden className="h-20 w-full rounded-xl" />
              <Skeleton aria-hidden className="h-20 w-full rounded-xl" />
            </div>
          ) : (
            <>
              <ManageRow
                icon={Plug}
                title={t('overview.link.integrations')}
                desc={t(canManageSettings ? 'overview.link.integrationsDesc' : 'overview.settings.askAdmin')}
              >
                {canManageSettings ? (
                  <Link
                    aria-label={t('overview.link.integrations')}
                    className="absolute inset-0 rounded-xl"
                    params={{ projectId }}
                    search={{ section: 'integrations' }}
                    to="/app/projects/$projectId/settings"
                  />
                ) : null}
              </ManageRow>
              <ManageRow
                icon={CreditCard}
                title={t('overview.link.billing')}
                desc={t(canManageSettings ? 'overview.link.billingDesc' : 'overview.settings.askAdmin')}
              >
                {canManageSettings ? (
                  <Link
                    aria-label={t('overview.link.billing')}
                    className="absolute inset-0 rounded-xl"
                    params={{ projectId }}
                    search={{ section: 'plan' }}
                    to="/app/projects/$projectId/settings"
                  />
                ) : null}
              </ManageRow>
              <ManageRow icon={SettingsIcon} title={t('overview.link.settings')} desc={t('overview.link.settingsDesc')}>
                <Link
                  aria-label={t('overview.link.settings')}
                  className="absolute inset-0 rounded-xl"
                  params={{ projectId }}
                  search={{ section: canManageSettings ? 'general' : 'languages' }}
                  to="/app/projects/$projectId/settings"
                />
              </ManageRow>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const publishIssuesOf = (deployment: Deployment) => {
  const details = (deployment as Deployment & { errorDetails?: unknown }).errorDetails;
  if (!Array.isArray(details)) {
    return [];
  }
  return details.flatMap((issue) => {
    const parsed = z
      .object({
        type: z.enum(['broken-link', 'grammar']),
        pageTitle: z.string(),
        pagePath: z.string(),
        detail: z.string(),
      })
      .safeParse(issue);
    return parsed.success ? [parsed.data] : [];
  });
};

/** Why the last publish failed: the structured check issues, each linking into
 *  the editor, plus "Publish anyway" when only the grammar linter is blocking. */
function PublishFailureCard({
  projectId,
  deployment,
  pages,
  viewOnly,
}: {
  projectId: string;
  deployment: Deployment;
  pages: Array<{ id: string; path: string }>;
  viewOnly: boolean;
}) {
  const t = useT();
  const issues = publishIssuesOf(deployment);
  const grammarOnly = issues.length > 0 && issues.every((issue) => issue.type === 'grammar');

  const publishAnyway = usePublishAnyway(projectId);
  const publishAnywayWithFeedback = () => {
    publishAnyway.mutate(deployment.id, {
      onSuccess: () => {
        toast.success(t('overview.publishFailed.queued'));
      },
      // Server text is English and technical; say what happened in plain words.
      onError: (error) => toast.error(friendlyErrorMessage(t, error, 'overview.publishFailed.error')),
    });
  };

  // Map a check issue's page path back to the draft page, for an editor deep link.
  const pageIdFor = (issuePath: string): string | undefined => {
    const clean = issuePath.replace(/^\/+/, '');
    return pages.find((page) => page.path === clean)?.id;
  };

  return (
    <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/5">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
          <TriangleAlert className="size-4" />
        </span>
        <div className="min-w-0 flex-1 leading-snug">
          <div className="font-semibold text-sm">{t('overview.publishFailed.title', { version: deployment.version })}</div>
          <p className="mt-0.5 text-muted-foreground text-sm">
            {deployment.errorDetails && !Array.isArray(deployment.errorDetails) && deployment.errorDetails.reason === 'review_stale'
              ? t('publish.reviewChanged')
              : grammarOnly
                ? t('overview.publishFailed.grammarOnly')
                : t('overview.publishFailed.body')}
          </p>
        </div>
        {grammarOnly ? (
          <Button
            disabled={viewOnly}
            loading={publishAnyway.isPending}
            loadingText={t('overview.publishFailed.publishing')}
            onClick={publishAnywayWithFeedback}
            size="sm"
            title={viewOnly ? t('access.viewOnly.publish') : undefined}
          >
            <Rocket className="size-3.5" />
            {t('overview.publishFailed.publishAnyway')}
          </Button>
        ) : null}
      </div>
      {issues.length > 0 ? (
        <ul className="divide-y divide-border border-border border-t">
          {issues.map((issue) => {
            const pageId = pageIdFor(issue.pagePath);
            return (
              <li key={`${issue.type}-${issue.pagePath}-${issue.detail}`} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  {issue.type === 'broken-link' ? <Link2Off className="size-3.5" /> : <SpellCheck className="size-3.5" />}
                </span>
                <div className="min-w-0 flex-1 leading-snug">
                  {pageId ? (
                    <Link
                      className="font-medium hover:underline"
                      to="/app/projects/$projectId/editor"
                      params={{ projectId }}
                      search={{ page: pageId }}
                    >
                      {issue.pageTitle || issue.pagePath}
                    </Link>
                  ) : (
                    <span className="font-medium">{issue.pageTitle || issue.pagePath}</span>
                  )}
                  <span className="ms-2 text-muted-foreground">{issue.detail}</span>
                </div>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-medium text-[10.5px] text-muted-foreground uppercase tracking-wide">
                  {issue.type === 'broken-link' ? t('overview.publishFailed.type.brokenLink') : t('overview.publishFailed.type.grammar')}
                </span>
              </li>
            );
          })}
        </ul>
      ) : deployment.error ? (
        // The worker's reason is English and technical: say what to do, keep the reason for support.
        <div className="border-border border-t px-5 py-3 text-sm">
          <p className="text-muted-foreground">{t('overview.publishFailed.unknown')}</p>
          <details className="mt-2 text-muted-foreground text-xs">
            <summary className="cursor-pointer select-none">{t('overview.publishFailed.technicalDetails')}</summary>
            <code className="mt-1.5 block whitespace-pre-wrap break-words" dir="ltr">
              {deployment.error}
            </code>
          </details>
        </div>
      ) : null}
    </div>
  );
}

const nudgeDismissKey = (projectId: string) => `nibleaf.publishNudge.${projectId}`;
const nudgeListeners = new Set<() => void>();
const subscribeNudge = (listener: () => void) => {
  nudgeListeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    nudgeListeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
};
const readNudgeDismissed = (projectId: string) => {
  try {
    return window.localStorage.getItem(nudgeDismissKey(projectId)) === '1';
  } catch {
    return false;
  }
};

/**
 * Whether this site's checklist was dismissed, read during render. It used to
 * start hidden and appear after an effect, which pushed the whole page down on
 * every visit. The server render shows it (most new sites haven't dismissed it);
 * a dismissed one is hidden at hydration. A dismissal in another tab applies here too.
 */
function useNudgeDismissed(projectId: string) {
  return useSyncExternalStore(
    subscribeNudge,
    () => readNudgeDismissed(projectId),
    () => false,
  );
}

/** First-publish checklist: shown until the site has a READY deployment. */
function PublishNudge({
  projectId,
  settingsAccess,
  permissionError,
}: {
  projectId: string;
  settingsAccess: SiteAdminState;
  permissionError?: React.ReactNode;
}) {
  const t = useT();
  // A dismissal also holds in memory, for when storage can't be written (private mode, quota, blocked storage).
  // Keyed by site: dismissing one site's checklist leaves the next site's alone.
  const [dismissedHere, setDismissedHere] = useState<string | null>(null);
  const dismissed = useNudgeDismissed(projectId) || dismissedHere === projectId;
  const { count } = useFormatters();
  const content = usePendingChanges(projectId, { enabled: !dismissed });
  const domains = useDomains(projectId);
  const editDone = content.data?.hasRealContent === true;
  const domainDone = (domains.data?.length ?? 0) > 0;
  const domainConnecting = domainDone && !pickLiveDomain(domains.data ?? []);
  const progressKnown = content.data?.hasRealContent !== undefined && domains.data !== undefined;
  const doneCount = Number(editDone) + Number(domainDone);
  if (dismissed) {
    return null;
  }
  const dismiss = () => {
    setDismissedHere(projectId);
    try {
      window.localStorage.setItem(nudgeDismissKey(projectId), '1');
    } catch {
      // ignore storage failures (private mode etc.)
    }
    for (const listener of nudgeListeners) listener();
  };

  return (
    <div className="relative mt-6 rounded-xl border border-primary/30 bg-primary/5 p-5">
      <button
        type="button"
        onClick={dismiss}
        aria-label={t('overview.nudge.dismiss')}
        title={t('overview.nudge.dismiss')}
        className="absolute end-3 top-3 cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X className="size-4" />
      </button>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Rocket className="size-4" />
        </span>
        <div className="leading-snug">
          <div className="font-semibold text-sm">{t('overview.nudge.title')}</div>
          <p className="mt-0.5 text-muted-foreground text-sm">{t('overview.nudge.body')}</p>
          <p aria-atomic="true" className="mt-0.5 text-muted-foreground text-sm" role="status">
            {progressKnown ? t('overview.nudge.progress', count(doneCount)) : null}
          </p>
        </div>
      </div>
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NudgeStep
          n={1}
          done={editDone}
          current={content.data?.hasRealContent === false}
          title={t('overview.nudge.step1')}
          desc={t('overview.nudge.step1Desc')}
        >
          <Link className="absolute inset-0" aria-label={t('overview.nudge.step1')} to="/app/projects/$projectId/editor" params={{ projectId }} />
        </NudgeStep>
        <NudgeStep n={2} current={editDone} title={t('overview.nudge.step2')} desc={t('overview.nudge.step2Desc')}>
          <Link
            className="absolute inset-0"
            aria-label={t('overview.nudge.step2')}
            to="/app/projects/$projectId/editor"
            params={{ projectId }}
            search={{ publish: true }}
          />
        </NudgeStep>
        <NudgeStep
          n={3}
          done={domainDone}
          title={t('overview.nudge.step3')}
          desc={
            <>
              {t('overview.nudge.step3Desc')}
              {domainConnecting ? <p className="mt-1">{t('overview.nudge.connecting')}</p> : null}
              {settingsAccess === 'notAdmin' ? <p className="mt-1">{t('overview.settings.askAdmin')}</p> : null}
              {permissionError}
            </>
          }
        >
          {settingsAccess === 'admin' ? (
            <Link
              className="absolute inset-0"
              aria-label={t('overview.nudge.step3')}
              to="/app/projects/$projectId/settings"
              params={{ projectId }}
              search={{ section: 'domain' }}
            />
          ) : null}
        </NudgeStep>
      </ol>
    </div>
  );
}

function NudgeStep({
  n,
  done,
  current,
  title,
  desc,
  children,
}: {
  n: number;
  done?: boolean;
  current?: boolean;
  title: string;
  desc: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <li
      aria-current={current ? 'step' : undefined}
      className={cn(
        'relative flex items-start gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/40 [&_a]:outline-none',
        current && 'border-primary',
      )}
    >
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-[12px] text-primary">
        {/* Named with its step, so a list of checks says which ones are finished. */}
        {done ? <Check aria-label={t('overview.nudge.stepDone', { step: title })} className="size-4" role="img" /> : n}
      </span>
      <div className="min-w-0 leading-snug">
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">{desc}</div>
      </div>
      {children}
    </li>
  );
}

/** A KPI tile's link: stretched over the tile, named after it. */
const TILE_LINK = 'absolute inset-0 rounded-xl';

function ManageRow({ icon: Icon, title, desc, children }: { icon: LucideIcon; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="relative flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/40 [&_a]:outline-none">
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Icon className="size-4" />
      </span>
      <div className="min-w-0 leading-snug">
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">{desc}</div>
      </div>
      {children}
    </div>
  );
}
