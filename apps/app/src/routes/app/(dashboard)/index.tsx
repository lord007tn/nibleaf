import { NibleafMark } from '@nibleaf/design-system/brand';
import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { AlertTriangle, BarChart3, BookText, FileText, Plus, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SectionCard } from '@/components/analytics/section-card';
import { ViewsAreaChart } from '@/components/analytics/views-area-chart';
import { NewProjectDialog } from '@/components/app/new-project-dialog';
import { QueryErrorState } from '@/components/query-error-state';
import type { AnalyticsRange } from '@/hooks/api';
import { useProjects, useWorkspaceAnalytics } from '@/hooks/api';
import { recordFirstPublishStage } from '@/lib/first-publish-activation';
import { useFormatters, viewsTrend } from '@/lib/format';

export const Route = createFileRoute('/app/(dashboard)/')({
  component: ProjectsPage,
  validateSearch: (search: Record<string, unknown>): { firstPublish?: boolean; newSite?: boolean } => ({
    ...(search.firstPublish === true || search.firstPublish === 'true' ? { firstPublish: true } : {}),
    ...(search.newSite === true || search.newSite === 'true' ? { newSite: true } : {}),
  }),
});

function ProjectsPage() {
  const { firstPublish, newSite } = Route.useSearch();
  const { data: projects, isPending, isError: projectsError, isFetching: projectsFetching, refetch: retryProjects } = useProjects();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const {
    data: analytics,
    isPending: analyticsPending,
    isError: analyticsError,
    isFetching: analyticsFetching,
    refetch: retryAnalytics,
  } = useWorkspaceAnalytics(range);
  const [newProjectOpen, setNewProjectOpen] = useState(Boolean(newSite));
  const t = useT();
  const navigate = useNavigate();
  const { number } = useFormatters();

  const totalPages = projects && !projectsError ? projects.reduce((sum, p) => sum + (p._count?.pages ?? 0), 0) : null;
  const analyticsUnavailable = analyticsError || analytics?.availability === 'unavailable';
  const trend = useMemo(() => (analyticsUnavailable ? null : viewsTrend(analytics?.timeseries ?? [])), [analytics?.timeseries, analyticsUnavailable]);
  const viewsByProject = useMemo(() => new Map((analytics?.byProject ?? []).map((b) => [b.projectId, b.views])), [analytics?.byProject]);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t('dashboard.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('dashboard.subtitle')}</p>
        </div>
        <Button onClick={() => setNewProjectOpen(true)}>
          <Plus className="size-4" /> {t('dashboard.newProject')}
        </Button>
        <NewProjectDialog open={newProjectOpen} onOpenChange={setNewProjectOpen} />
      </div>

      {projectsError ? <QueryErrorState onRetry={() => void retryProjects()} retrying={projectsFetching} /> : null}
      {analyticsError ? <QueryErrorState onRetry={() => void retryAnalytics()} retrying={analyticsFetching} /> : null}
      {!analyticsError && (analyticsUnavailable || analytics?.availability === 'partial') ? (
        <Alert variant="warning">
          <AlertTriangle />
          <AlertTitle>{t(analyticsUnavailable ? 'analytics.state.unavailable.title' : 'analytics.state.partial.title')}</AlertTitle>
          <AlertDescription>{t(analyticsUnavailable ? 'analytics.state.unavailable.body' : 'analytics.state.partial.body')}</AlertDescription>
        </Alert>
      ) : null}

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SectionCard
          label={t('dashboard.stats.projects')}
          value={projectsError ? null : (projects?.length ?? null)}
          icon={<BookText className="size-4" />}
          loading={isPending}
        />
        <SectionCard label={t('dashboard.stats.pages')} value={totalPages} icon={<FileText className="size-4" />} loading={isPending} />
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

      {/* Sites table */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-border border-b px-5 py-3.5">
          <h2 className="font-semibold text-sm">{t('dashboard.sitesTable')}</h2>
        </div>
        {isPending ? (
          <div className="space-y-2 p-5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : projectsError && !projects ? null : (projects ?? []).length === 0 ? (
          // Also the recovery path for a user whose workspace provisioning
          // failed at sign-up: creating a project mints a fresh workspace.
          <div className="grid place-items-center py-16 text-center">
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
                <TableHead className="text-end">{t('dashboard.col.views')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(projects ?? []).map((project) => (
                <TableRow key={project.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <NibleafMark className="size-8 shrink-0" />
                      <Link
                        className="min-w-0 rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        to="/app/projects/$projectId"
                        params={{ projectId: project.id }}
                      >
                        <div className="truncate font-medium">{project.name}</div>
                        <div className="truncate font-mono text-muted-foreground text-xs">/{project.slug}</div>
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{number(project._count?.pages ?? 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{number(project._count?.deployments ?? 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{analyticsUnavailable ? '—' : number(viewsByProject.get(project.id) ?? 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
