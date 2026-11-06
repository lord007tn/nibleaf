import { NibleafMark } from '@nibleaf/design-system/brand';
import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { useT } from '@nibleaf/i18n/react';
import { useQueries } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, BarChart3, BookText, Check, FileText, Plus, Users, X } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { SectionCard } from '@/components/analytics/section-card';
import { ViewsAreaChart } from '@/components/analytics/views-area-chart';
import { NewProjectDialog } from '@/components/app/new-project-dialog';
import { QueryErrorState } from '@/components/query-error-state';
import type { AnalyticsRange } from '@/hooks/api';
import { useProjectMembers, useProjects, useWorkspaceAnalytics } from '@/hooks/api';
import { getData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import type { Deployment, PageNode } from '@/hooks/api/types';
import { projectsQueryOptions } from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { recordFirstPublishStage } from '@/lib/first-publish-activation';
import { useFormatters, viewsTrend } from '@/lib/format';
import { type SiteActivity, type StartHereProgress, startHereProgress, startHereRequests } from '@/lib/start-here';
import { api } from '@/services/api';
import { useSession } from '@/services/auth-client';

export const Route = createFileRoute('/app/(dashboard)/')({
  validateSearch: (search: Record<string, unknown>): { firstPublish?: boolean; newSite?: boolean } => ({
    ...(search.firstPublish === true || search.firstPublish === 'true' ? { firstPublish: true } : {}),
    ...(search.newSite === true || search.newSite === 'true' ? { newSite: true } : {}),
  }),
  loader: ({ context: { queryClient } }) => prefetchRouteData(queryClient, projectsQueryOptions()),
  component: ProjectsPage,
});

const subscribeToHydration = () => () => undefined;
/** Per user, so a colleague signing up on a shared desk machine still gets the path. */
const startHereDismissedKey = (userId: string | undefined) => (userId ? `nibleaf.startHere.dismissed.${userId}` : null);
const readStartHereDismissed = (key: string | null) => {
  // Hidden until the signed-in user is known, so it never flashes for someone who dismissed it.
  if (!key) return true;
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};
const isInFlight = (deployments: Deployment[] | undefined) => deployments?.some((d) => d.status === 'PENDING' || d.status === 'BUILDING') ?? false;

/**
 * The publish history and (for the sample) page list the checklist needs. They
 * share cache entries with the editor's own deployments/pages queries, refetch
 * on every visit, and poll while a publish is still building, so a publish
 * finishing — or failing — shows up here without a reload.
 */
function useStartHereActivity(deploymentSiteIds: string[], pageSiteIds: string[]): ReadonlyMap<string, SiteActivity> {
  const deploymentResults = useQueries({
    queries: deploymentSiteIds.map((projectId) => ({
      queryKey: queryKeys.deployments.all(projectId),
      staleTime: 0,
      queryFn: async () => getData<Deployment[]>(await api.app.projects[':projectId'].deployments.$get({ param: { projectId } }), 'deployments'),
      refetchInterval: (query: { state: { data?: Deployment[] } }) => (isInFlight(query.state.data) ? 2500 : false),
    })),
  });
  const pageResults = useQueries({
    queries: pageSiteIds.map((projectId) => ({
      queryKey: queryKeys.pages.all(projectId),
      staleTime: 0,
      queryFn: async () => getData<PageNode[]>(await api.app.projects[':projectId'].pages.$get({ param: { projectId }, query: {} }), 'pages'),
    })),
  });
  const activity = new Map<string, SiteActivity>();
  deploymentSiteIds.forEach((projectId, index) => {
    activity.set(projectId, { ...activity.get(projectId), deployments: deploymentResults[index]?.data });
  });
  pageSiteIds.forEach((projectId, index) => {
    activity.set(projectId, { ...activity.get(projectId), pages: pageResults[index]?.data });
  });
  return activity;
}

function ProjectsPage() {
  const { firstPublish, newSite } = Route.useSearch();
  const { data: projects, isPending, isError: projectsError, isFetching: projectsFetching, refetch: retryProjects } = useProjects();
  // The shared project query can resolve before this streamed route hydrates.
  // Render the server's loading tree until hydration so the markup matches.
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const projectsLoading = !hydrated || isPending;
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const {
    data: analytics,
    isPending: analyticsPending,
    isError: analyticsError,
    isFetching: analyticsFetching,
    refetch: retryAnalytics,
  } = useWorkspaceAnalytics(range);
  const [newProjectOpen, setNewProjectOpen] = useState(Boolean(newSite));
  const { data: session } = useSession();
  const dismissedKey = startHereDismissedKey(session?.user?.id);
  const storedDismissed = useSyncExternalStore(
    subscribeToHydration,
    () => readStartHereDismissed(dismissedKey),
    () => true,
  );
  const [dismissedNow, setDismissedNow] = useState(false);
  const t = useT();
  const navigate = useNavigate();
  const { number } = useFormatters();

  const siteList = useMemo(() => projects ?? [], [projects]);
  const focusId = useMemo(() => startHereProgress(siteList, undefined).focus?.id, [siteList]);
  const { data: team } = useProjectMembers(focusId);
  const teamSize = team ? team.members.length + (team.invitations?.length ?? 0) : undefined;
  const requests = useMemo(() => startHereRequests(siteList), [siteList]);
  const activity = useStartHereActivity(requests.deploymentSiteIds, requests.pageSiteIds);
  const progress = startHereProgress(siteList, teamSize, activity);

  const totalPages = projects && !projectsError ? projects.reduce((sum, p) => sum + (p._count?.pages ?? 0), 0) : null;
  const analyticsUnavailable = analyticsError || analytics?.availability === 'unavailable';
  const trend = useMemo(() => (analyticsUnavailable ? null : viewsTrend(analytics?.timeseries ?? [])), [analytics?.timeseries, analyticsUnavailable]);
  const viewsByProject = useMemo(() => new Map((analytics?.byProject ?? []).map((b) => [b.projectId, b.views])), [analytics?.byProject]);
  const hasSites = !projectsLoading && siteList.length > 0;
  // A brand-new user gets a "what to do next" path, not a wall of zeros:
  // analytics appear once they've published something or have traffic.
  const showAnalytics = !projectsLoading && (projectsError || progress.published || (analytics?.totalViews ?? 0) > 0);
  const showStartHere = hasSites && !projectsError && progress.done < progress.total && !storedDismissed && !dismissedNow;

  useEffect(() => {
    const starterProject = projects?.[0];
    if (!firstPublish || !starterProject) return;
    void recordFirstPublishStage('project_entered');
    void navigate({
      to: '/app/projects/$projectId/editor',
      params: { projectId: starterProject.id },
      search: { firstPublish: true },
      replace: true,
    });
  }, [firstPublish, navigate, projects]);

  const dismissStartHere = () => {
    setDismissedNow(true);
    if (!dismissedKey) return;
    try {
      window.localStorage.setItem(dismissedKey, '1');
    } catch {
      // Storage can be unavailable (private mode); the card stays hidden for this visit.
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="font-semibold text-2xl tracking-tight">{t('dashboard.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('dashboard.subtitle')}</p>
        </div>
        <Button onClick={() => setNewProjectOpen(true)}>
          <Plus className="size-4" /> {t('dashboard.newProject')}
        </Button>
        <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      </div>

      {projectsError ? <QueryErrorState onRetry={() => void retryProjects()} retrying={projectsFetching} /> : null}

      {showStartHere ? <StartHere onCreateSite={() => setNewProjectOpen(true)} onDismiss={dismissStartHere} progress={progress} /> : null}

      {/* Sites come first so they're never pushed below the fold on a phone. */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-border border-b px-5 py-3.5">
          <h2 className="font-semibold text-sm">{t('dashboard.sitesTable')}</h2>
        </div>
        {projectsLoading ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : projectsError && !projects ? null : siteList.length === 0 ? (
          // Also the recovery path for a user whose workspace provisioning
          // failed at sign-up: creating a site mints a fresh workspace.
          <div className="grid place-items-center px-5 py-16 text-center">
            <BookText className="size-7 text-muted-foreground" />
            <p className="mt-3 font-medium">{t('dashboard.empty.title')}</p>
            <p className="mt-1 max-w-sm text-muted-foreground text-sm">{t('dashboard.empty.body')}</p>
            <Button className="mt-4" onClick={() => setNewProjectOpen(true)}>
              <Plus className="size-4" /> {t('dashboard.empty.cta')}
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('dashboard.col.site')}</TableHead>
                <TableHead className="text-end">{t('dashboard.col.pages')}</TableHead>
                <TableHead className="text-end">{t('dashboard.col.deploys')}</TableHead>
                {showAnalytics ? <TableHead className="text-end">{t('dashboard.col.views')}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {siteList.map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <NibleafMark className="size-8 shrink-0" />
                      <Link
                        className="min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        to="/app/projects/$projectId"
                        params={{ projectId: project.id }}
                      >
                        <div className="truncate font-medium">
                          <bdi>{project.name}</bdi>
                        </div>
                        <div className="truncate font-mono text-muted-foreground text-xs">
                          <bdi dir="ltr">/{project.slug}</bdi>
                        </div>
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{number(project._count?.pages ?? 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{number(project._count?.deployments ?? 0)}</TableCell>
                  {showAnalytics ? (
                    <TableCell className="text-end tabular-nums">
                      {analyticsUnavailable ? '—' : number(viewsByProject.get(project.id) ?? 0)}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {showAnalytics ? (
        <>
          {analyticsError ? <QueryErrorState onRetry={() => void retryAnalytics()} retrying={analyticsFetching} /> : null}
          {!analyticsError && (analyticsUnavailable || analytics?.availability === 'partial') ? (
            <Alert variant="warning">
              <AlertTriangle />
              <AlertTitle>{t(analyticsUnavailable ? 'analytics.state.unavailable.title' : 'analytics.state.partial.title')}</AlertTitle>
              <AlertDescription>{t(analyticsUnavailable ? 'analytics.state.unavailable.body' : 'analytics.state.partial.body')}</AlertDescription>
            </Alert>
          ) : null}

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <SectionCard
              label={t('dashboard.stats.projects')}
              value={projectsError ? null : (projects?.length ?? null)}
              icon={<BookText className="size-4" />}
              loading={projectsLoading}
            />
            <SectionCard label={t('dashboard.stats.pages')} value={totalPages} icon={<FileText className="size-4" />} loading={projectsLoading} />
            <SectionCard
              label={t('dashboard.stats.pageViews')}
              value={analyticsUnavailable ? null : (analytics?.totalViews ?? null)}
              icon={<BarChart3 className="size-4" />}
              trend={trend}
              hint={trend ? t('analytics.vsPrevious') : undefined}
              loading={analyticsPending}
            />
            {/* No visitor-specific timeseries exists yet, so no trend badge here —
                the page-views trend would be misleading on a visitors metric. */}
            <SectionCard
              label={t('dashboard.stats.visitors')}
              value={analyticsUnavailable ? null : (analytics?.uniqueVisitors ?? null)}
              icon={<Users className="size-4" />}
              loading={analyticsPending}
            />
          </div>

          {/* Interactive views chart */}
          {analyticsUnavailable ? (
            <div className="grid min-h-64 place-items-center rounded-xl border border-border bg-card p-5 text-muted-foreground text-sm">
              {t('analytics.state.unknown')}
            </div>
          ) : (
            <ViewsAreaChart
              title={t('dashboard.viewsTitle')}
              description={t('dashboard.viewsDesc')}
              data={analytics?.timeseries ?? []}
              range={range}
              onRangeChange={setRange}
              loading={analyticsPending}
            />
          )}
        </>
      ) : null}
    </div>
  );
}

/** First-run path: three plain steps with real progress, each opening the right screen. */
function StartHere({ progress, onCreateSite, onDismiss }: { progress: StartHereProgress; onCreateSite: () => void; onDismiss: () => void }) {
  const t = useT();
  const projectId = progress.focus?.id;
  const steps: Array<{ key: string; done: boolean; title: string; desc: string; link: (className: string, label: string) => ReactNode }> = [
    {
      key: 'write',
      done: progress.wrote,
      title: t('dashboard.start.step1'),
      desc: t('dashboard.start.step1Desc'),
      link: (className, label) =>
        projectId ? (
          <Link aria-label={label} className={className} params={{ projectId }} to="/app/projects/$projectId/editor" />
        ) : (
          <button aria-label={label} className={className} onClick={onCreateSite} type="button" />
        ),
    },
    {
      key: 'publish',
      done: progress.published,
      title: t('dashboard.start.step2'),
      desc: t('dashboard.start.step2Desc'),
      link: (className, label) =>
        projectId ? (
          <Link aria-label={label} className={className} params={{ projectId }} search={{ publish: true }} to="/app/projects/$projectId/editor" />
        ) : null,
    },
    {
      key: 'invite',
      done: progress.invited,
      title: t('dashboard.start.step3'),
      desc: t('dashboard.start.step3Desc'),
      link: (className, label) =>
        projectId ? (
          <Link
            aria-label={label}
            className={className}
            params={{ projectId }}
            search={{ section: 'members' }}
            to="/app/projects/$projectId/settings"
          />
        ) : null,
    },
  ];

  return (
    <section aria-labelledby="start-here-title" className="relative rounded-xl border border-primary/30 bg-primary/5 p-5">
      <button
        aria-label={t('overview.nudge.dismiss')}
        className="absolute end-3 top-3 grid size-8 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:size-10"
        onClick={onDismiss}
        title={t('overview.nudge.dismiss')}
        type="button"
      >
        <X className="size-4" />
      </button>
      <div className="pe-10">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="font-semibold text-lg" id="start-here-title">
            {t('dashboard.start.title')}
          </h2>
          <span className="text-muted-foreground text-sm">{t('dashboard.start.progress', { done: progress.done, total: progress.total })}</span>
        </div>
        <p className="mt-1 text-muted-foreground text-sm">{t('dashboard.start.body')}</p>
        {progress.hasSample ? <p className="mt-1 text-sm">{t('dashboard.start.sample')}</p> : null}
      </div>
      <ol className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li
            className="relative flex items-start gap-3 rounded-lg border border-border bg-card p-3.5 transition-colors focus-within:ring-3 focus-within:ring-ring/50 hover:bg-muted/40"
            key={step.key}
          >
            <span
              className={`grid size-6 shrink-0 place-items-center rounded-full font-semibold text-[12px] ${step.done ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary'}`}
            >
              {step.done ? <Check aria-hidden className="size-3.5" /> : index + 1}
            </span>
            <div className="min-w-0 leading-snug">
              <div className={`font-medium text-sm ${step.done ? 'text-muted-foreground line-through' : ''}`}>
                {step.title}
                {step.done ? <span className="sr-only"> ({t('dashboard.start.done')})</span> : null}
              </div>
              <div className="mt-0.5 text-muted-foreground text-xs">{step.desc}</div>
            </div>
            {step.link('absolute inset-0 rounded-lg outline-none', step.title)}
          </li>
        ))}
      </ol>
    </section>
  );
}
