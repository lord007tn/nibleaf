import { NibleafMark } from '@nibleaf/design-system/brand';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { BarChart3, BookText, FileText, Plus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SectionCard } from '@/components/analytics/section-card';
import { ViewsAreaChart } from '@/components/analytics/views-area-chart';
import type { AnalyticsRange } from '@/hooks/api';
import { useCreateProject, useProjects, useWorkspaceAnalytics } from '@/hooks/api';
import { required } from '@/lib/form';
import { useFormatters, viewsTrend } from '@/lib/format';
import { useT } from '@/lib/i18n';

export const Route = createFileRoute('/app/(dashboard)/')({
  component: ProjectsPage,
  validateSearch: (search: Record<string, unknown>): { newSite?: boolean } =>
    search.newSite === true || search.newSite === 'true' ? { newSite: true } : {},
});

/** Controlled create dialog so multiple triggers (header button + the empty
 *  state's CTA) share one instance. Creating a project also mints its own
 *  workspace (organization) server-side, so this works even for a user whose
 *  sign-up provisioning failed and who belongs to no workspace at all. */
function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateProject();
  const t = useT();

  const form = useForm({
    defaultValues: { name: '' },
    onSubmit: async ({ value }) => {
      await new Promise<void>((resolve) => {
        create.mutate(
          { name: value.name.trim() },
          {
            onSuccess: () => {
              toast.success(t('newSite.created'));
              form.reset();
              onOpenChange(false);
              resolve();
            },
            onError: (error) => {
              toast.error(error instanceof Error ? error.message : t('newSite.error'));
              resolve();
            },
          },
        );
      });
    },
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('newSite.title')}</DialogTitle>
            <DialogDescription>{t('newSite.desc')}</DialogDescription>
          </DialogHeader>
          <div className="my-4 flex flex-col gap-1.5">
            <form.Field name="name" validators={{ onChange: ({ value }) => required(t('newSite.name'), t)(value) }}>
              {(field) => (
                <>
                  <Label htmlFor="project-name">{t('newSite.name')}</Label>
                  <Input
                    autoFocus
                    id="project-name"
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="API Reference"
                    value={field.state.value}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </>
              )}
            </form.Field>
          </div>
          <DialogFooter>
            <form.Subscribe selector={(state) => [state.isSubmitting, state.values.name] as const}>
              {([isSubmitting, name]) => (
                <Button disabled={isSubmitting || !name.trim()} type="submit">
                  {isSubmitting ? t('newSite.creating') : t('newSite.create')}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ProjectsPage() {
  const { newSite } = Route.useSearch();
  const { data: projects, isPending } = useProjects();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const { data: analytics, isPending: analyticsPending } = useWorkspaceAnalytics(range);
  const [newProjectOpen, setNewProjectOpen] = useState(Boolean(newSite));
  const t = useT();
  const navigate = useNavigate();
  const { number } = useFormatters();

  const totalPages = (projects ?? []).reduce((sum, p) => sum + (p._count?.pages ?? 0), 0);
  const trend = useMemo(() => viewsTrend(analytics?.timeseries ?? []), [analytics?.timeseries]);
  const viewsByProject = useMemo(() => new Map((analytics?.byProject ?? []).map((b) => [b.projectId, b.views])), [analytics?.byProject]);

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

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SectionCard label={t('dashboard.stats.projects')} value={projects?.length ?? 0} icon={<BookText className="size-4" />} loading={isPending} />
        <SectionCard label={t('dashboard.stats.pages')} value={totalPages} icon={<FileText className="size-4" />} loading={isPending} />
        <SectionCard
          label={t('dashboard.stats.pageViews')}
          value={analytics?.totalViews ?? 0}
          icon={<BarChart3 className="size-4" />}
          trend={trend}
          hint={trend ? t('analytics.vsPrevious') : undefined}
          loading={analyticsPending}
        />
        {/* No visitor-specific timeseries exists yet, so no trend badge here —
            the page-views trend would be misleading on a visitors metric. */}
        <SectionCard
          label={t('dashboard.stats.visitors')}
          value={analytics?.uniqueVisitors ?? 0}
          icon={<Users className="size-4" />}
          loading={analyticsPending}
        />
      </div>

      {/* Interactive views chart */}
      <ViewsAreaChart
        title={t('dashboard.viewsTitle')}
        description={t('dashboard.viewsDesc')}
        data={analytics?.timeseries ?? []}
        range={range}
        onRangeChange={setRange}
        loading={analyticsPending}
      />

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
        ) : (projects ?? []).length === 0 ? (
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
                <TableRow
                  key={project.id}
                  className="cursor-pointer"
                  onClick={() => navigate({ to: '/app/projects/$projectId', params: { projectId: project.id } })}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <NibleafMark className="size-8 shrink-0" />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{project.name}</div>
                        <div className="truncate font-mono text-muted-foreground text-xs">/{project.slug}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-end tabular-nums">{number(project._count?.pages ?? 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{number(project._count?.deployments ?? 0)}</TableCell>
                  <TableCell className="text-end tabular-nums">{number(viewsByProject.get(project.id) ?? 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
