import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import {
  ArrowRight,
  BarChart3,
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
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { SectionCard } from '@/components/analytics/section-card';
import { ViewsAreaChart } from '@/components/analytics/views-area-chart';
import { InlineSkeleton } from '@/components/inline-skeleton';
import { QueryErrorState } from '@/components/query-error-state';
import { env } from '@/env';
import type { AnalyticsRange, Deployment } from '@/hooks/api';
import { friendlyErrorMessage, useDeployments, useDomains, usePages, useProject, useProjectMembers, usePublishAnyway } from '@/hooks/api';
import { useProjectAnalytics } from '@/hooks/api/analytics';
import { analyticsTimezone, projectAnalyticsQueryOptions } from '@/hooks/api/analytics/query-options';
import { domainsQueryOptions, projectMembersQueryOptions } from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { deploymentStatusLabel, deploymentStatusVariant } from '@/lib/deployment-status';
import { useFormatters, viewsTrend } from '@/lib/format';
import { resolveProjectSettingsAccess } from '@/lib/project-settings-access';
import { useSession } from '@/services/auth-client';

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

// Only present a `slug.<base>` free-subdomain host when a base domain is actually
// configured for this deployment; otherwise it 404s, so we fall back to /sites/:id.
const siteBaseDomain = () => env.VITE_SITE_BASE_DOMAIN?.replace(/^\*\./, '').replace(/\.$/, '') || undefined;
const siteUrl = (domain: string | null, projectId: string) => (domain ? `https://${domain}` : `/sites/${projectId}`);
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
  const { data: pages, isPending: pagesPending } = usePages(projectId);
  const membersQuery = useProjectMembers(projectId);
  const { data: members, isPending: membersPending } = membersQuery;
  const { data: deployments, isPending: deploymentsPending } = useDeployments(projectId);
  const { data: domains } = useDomains(projectId);
  const { data: analytics, isPending: analyticsPending, isError: analyticsError } = useProjectAnalytics(projectId, range);
  const analyticsUnknown = analyticsError || analytics?.availability === 'unavailable';

  const pageCount = (pages ?? []).filter((page) => page.kind !== 'GROUP').length;
  const { data: session, isPending: sessionPending } = useSession();
  const settingsAccess = resolveProjectSettingsAccess(
    members?.members.find((member) => member.user.id === session?.user.id)?.role,
    membersPending || sessionPending || !members || !session,
  );
  const canManageSettings = settingsAccess === 'admin';
  const memberCount = members?.members.length ?? 0;
  const deployCount = (deployments ?? []).length;
  const latestDeployment = deployments?.[0];
  const hasReadyDeployment = (deployments ?? []).some((deployment) => deployment.status === 'READY');
  const publishFailed = latestDeployment?.status === 'FAILED';
  const primaryDomain = domains?.find((domain) => domain.isPrimary && domain.verified) ?? domains?.find((domain) => domain.verified);
  const baseDomain = siteBaseDomain();
  // Prefer a verified custom domain; else a configured free-subdomain host; else
  // the always-working internal /sites/:id path (never a hardcoded fake host).
  const liveDomain = primaryDomain?.domain ?? (project && baseDomain ? `${project.slug}.${baseDomain}` : null);
  const liveHref = siteUrl(liveDomain, projectId);
  const trend = useMemo(() => viewsTrend(analytics?.timeseries ?? []), [analytics?.timeseries]);
  const recentPages = useMemo(
    () =>
      (pages ?? [])
        .filter((p) => p.kind === 'PAGE')
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 6),
    [pages],
  );

  return (
    <div className="w-full px-6 py-8 xl:px-10">
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
          {hasReadyDeployment ? (
            <Button
              nativeButton={false}
              render={<a href={liveHref} target="_blank" rel="noreferrer" aria-label={t('overview.viewSite')} />}
              size="sm"
              variant="outline"
            >
              <Eye className="size-3.5" /> {t('overview.viewSite')}
            </Button>
          ) : deployments ? (
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
            <PenLine className="size-3.5" /> {t('overview.openEditor')}
          </Button>
        </div>
      </div>

      {/* Publish-failure triage: what blocked the last publish, with per-page
          links into the editor and a grammar-only "Publish anyway" escape hatch. */}
      {publishFailed && latestDeployment ? <PublishFailureCard projectId={projectId} deployment={latestDeployment} pages={pages ?? []} /> : null}

      {/* First-publish nudge: shown until the site has one READY deployment.
          Hidden while the latest attempt is FAILED (the failure card leads). */}
      {deployments && !hasReadyDeployment && !publishFailed ? (
        <PublishNudge
          projectId={projectId}
          settingsAccess={settingsAccess}
          permissionError={
            membersQuery.isError && !members ? (
              <QueryErrorState onRetry={() => void membersQuery.refetch()} retrying={membersQuery.isFetching} />
            ) : undefined
          }
        />
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-primary/10 text-primary">
              <Globe2 className="size-4" />
            </span>
            <div className="min-w-0">
              <div className="font-semibold text-sm">{t('overview.live.title')}</div>
              {deploymentsPending ? (
                <Skeleton className="mt-1 h-4 w-40" />
              ) : hasReadyDeployment ? (
                <a className="block truncate font-mono text-primary text-sm hover:underline" href={liveHref} target="_blank" rel="noreferrer">
                  <bdi dir="ltr">{liveDomain ?? liveHref}</bdi>
                </a>
              ) : (
                <>
                  <p className="text-muted-foreground text-sm">{t('overview.live.unavailable')}</p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    {t('overview.live.publishHint')}{' '}
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
            {latestDeployment ? (
              <Badge variant={deploymentStatusVariant(latestDeployment.status)}>{deploymentStatusLabel(latestDeployment.status, t)}</Badge>
            ) : null}
          </div>
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
            {(deployments ?? []).slice(0, 3).map((deployment) => (
              <div className="flex items-center justify-between gap-3 text-sm" key={deployment.id}>
                {/* The version tag is code (always LTR); commit messages are free
                    text in whatever language the author wrote, so they resolve
                    their own direction and truncate on their own end. */}
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="shrink-0 font-medium" dir="ltr">
                    v{deployment.version}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground" dir="auto">
                    {deployment.commitMessage || t('overview.activity.publish')}
                  </span>
                </div>
                <span className="shrink-0 text-muted-foreground text-xs">{date(deployment.completedAt ?? deployment.createdAt)}</span>
              </div>
            ))}
            {deployments && deployments.length === 0 ? <p className="text-muted-foreground text-sm">{t('overview.activity.empty')}</p> : null}
          </div>
        </div>
      </div>

      {/* KPI cards */}
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SectionCard label={t('overview.stats.pages')} value={pageCount} icon={<FileText className="size-4" />} loading={pagesPending} />
        <SectionCard label={t('overview.stats.members')} value={memberCount} icon={<Users className="size-4" />} loading={membersPending} />
        <SectionCard label={t('overview.stats.deploys')} value={deployCount} icon={<Rocket className="size-4" />} loading={deploymentsPending} />
        <SectionCard
          label={t('overview.stats.pageviews')}
          value={analytics?.totalViews ?? null}
          icon={<BarChart3 className="size-4" />}
          trend={trend}
          hint={trend ? t('analytics.vsPrevious') : undefined}
          loading={analyticsPending}
        />
      </div>

      {/* Traffic chart */}
      <div className="mt-6">
        <ViewsAreaChart
          title={t('overview.viewsTitle')}
          description={t('overview.viewsDesc')}
          data={analytics?.timeseries ?? []}
          range={range}
          onRangeChange={setRange}
          loading={analyticsPending}
          unavailable={analyticsUnknown}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_320px]">
        {/* Recent pages */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-border border-b px-5 py-3.5">
            <h2 className="font-semibold text-sm">{t('overview.recentPages')}</h2>
            <Link
              className="flex items-center gap-1 text-primary text-xs hover:underline"
              params={{ projectId }}
              to="/app/projects/$projectId/editor"
            >
              {t('overview.openEditor')} <ArrowRight className="size-3 rtl:-scale-x-100" />
            </Link>
          </div>
          {pagesPending ? (
            <div aria-busy="true">
              <Table aria-hidden>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('overview.col.page')}</TableHead>
                    <TableHead className="text-end">{t('overview.col.updated')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Shaped like a recent-page row: icon and title, then the date. */}
                  {RECENT_PAGE_SKELETON_ROWS.map((row) => (
                    <TableRow key={row}>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Skeleton className="size-3.5 shrink-0 rounded-sm" />
                          <Skeleton className="h-4 w-1/2" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Skeleton className="ms-auto h-3 w-16" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : recentPages.length === 0 ? (
            <p className="px-5 py-8 text-center text-muted-foreground text-sm">{t('overview.noPages')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('overview.col.page')}</TableHead>
                  <TableHead className="text-end">{t('overview.col.updated')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentPages.map((page) => (
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
                        <span className="truncate font-medium" dir="auto">
                          {page.config?.sidebarTitle?.trim() || page.title}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-end text-muted-foreground text-xs">{date(page.updatedAt)}</TableCell>
                  </TableRow>
                ))}
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
          {membersQuery.isError && !members ? (
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
}: {
  projectId: string;
  deployment: Deployment;
  pages: Array<{ id: string; path: string }>;
}) {
  const t = useT();
  const issues = publishIssuesOf(deployment);
  const grammarOnly = issues.length > 0 && issues.every((issue) => issue.type === 'grammar');

  const publishAnyway = usePublishAnyway(projectId);
  const publishAnywayWithFeedback = () => {
    publishAnyway.mutate(undefined, {
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
            {grammarOnly ? t('overview.publishFailed.grammarOnly') : t('overview.publishFailed.body')}
          </p>
        </div>
        {grammarOnly ? (
          <Button
            loading={publishAnyway.isPending}
            loadingText={t('overview.publishFailed.publishing')}
            onClick={publishAnywayWithFeedback}
            size="sm"
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
        <p className="border-border border-t px-5 py-3 text-muted-foreground text-sm">{deployment.error}</p>
      ) : null}
    </div>
  );
}

const nudgeDismissKey = (projectId: string) => `nibleaf.publishNudge.${projectId}`;

/** First-publish checklist: shown until the site has a READY deployment. */
function PublishNudge({
  projectId,
  settingsAccess,
  permissionError,
}: {
  projectId: string;
  settingsAccess: ReturnType<typeof resolveProjectSettingsAccess>;
  permissionError?: React.ReactNode;
}) {
  const t = useT();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(nudgeDismissKey(projectId)) === '1');
    } catch {
      setDismissed(false);
    }
  }, [projectId]);
  if (dismissed) {
    return null;
  }
  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(nudgeDismissKey(projectId), '1');
    } catch {
      // ignore storage failures (private mode etc.)
    }
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
        </div>
      </div>
      <ol className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <NudgeStep n={1} title={t('overview.nudge.step1')} desc={t('overview.nudge.step1Desc')}>
          <Link className="absolute inset-0" aria-label={t('overview.nudge.step1')} to="/app/projects/$projectId/editor" params={{ projectId }} />
        </NudgeStep>
        <NudgeStep n={2} title={t('overview.nudge.step2')} desc={t('overview.nudge.step2Desc')}>
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
          title={t('overview.nudge.step3')}
          desc={permissionError ?? t(settingsAccess === 'notAdmin' ? 'overview.settings.askAdmin' : 'overview.nudge.step3Desc')}
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

function NudgeStep({ n, title, desc, children }: { n: number; title: string; desc: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="relative flex items-start gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/40 [&_a]:outline-none">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 font-semibold text-[12px] text-primary">{n}</span>
      <div className="min-w-0 leading-snug">
        <div className="font-medium text-sm">{title}</div>
        <div className="mt-0.5 text-muted-foreground text-xs">{desc}</div>
      </div>
      {children}
    </li>
  );
}

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
