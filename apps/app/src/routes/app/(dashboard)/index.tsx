import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { BarChart3, BookText, FileText, Plus, Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TrafficPanel } from '@/components/analytics/traffic-panel';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { useCreateProject, useProjects, useWorkspaceAnalytics } from '@/hooks/api';
import { required } from '@/lib/form';
import { useFormatters } from '@/lib/format';
import { useT } from '@/lib/i18n';

export const Route = createFileRoute('/app/(dashboard)/')({
  component: ProjectsPage,
});

function NewProjectDialog() {
  const [open, setOpen] = useState(false);
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
              setOpen(false);
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
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button>
            <Plus className="size-4" /> {t('dashboard.newProject')}
          </Button>
        }
      />
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
            <form.Field name="name" validators={{ onChange: ({ value }) => required('Name')(value) }}>
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
  const { data: projects, isPending } = useProjects();
  const { data: analytics } = useWorkspaceAnalytics('30d');
  const t = useT();
  const navigate = useNavigate();
  const { number } = useFormatters();
  const totalPages = (projects ?? []).reduce((sum, p) => sum + (p._count?.pages ?? 0), 0);
  const totalDeploys = (projects ?? []).reduce((sum, p) => sum + (p._count?.deployments ?? 0), 0);

  // Single-site accounts skip the global view and land straight in their site;
  // the global dashboard is only meaningful for members of more than one site.
  const soleProjectId = !isPending && projects?.length === 1 ? projects[0]?.id : undefined;
  useEffect(() => {
    if (soleProjectId) {
      navigate({ to: '/app/projects/$projectId', params: { projectId: soleProjectId }, replace: true });
    }
  }, [soleProjectId, navigate]);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-3xl tracking-tight">{t('dashboard.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('dashboard.subtitle')}</p>
        </div>
        <NewProjectDialog />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: t('dashboard.stats.projects'), value: projects?.length ?? 0, icon: BookText },
          { label: t('dashboard.stats.pages'), value: totalPages, icon: FileText },
          { label: t('dashboard.stats.deploys'), value: totalDeploys, icon: Rocket },
          { label: t('dashboard.stats.pageViews'), value: analytics?.totalViews ?? 0, icon: BarChart3 },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <stat.icon className="size-4" /> {stat.label}
            </div>
            <div className="mt-2 font-semibold text-3xl tracking-tight tabular-nums">{number(stat.value)}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex flex-col gap-3">
          {isPending ? (
            [0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
          ) : (projects ?? []).length === 0 ? (
            <div className="grid place-items-center rounded-xl border border-border border-dashed py-16 text-center">
              <BookText className="size-7 text-muted-foreground" />
              <p className="mt-3 font-medium">{t('dashboard.empty.title')}</p>
              <p className="mt-1 max-w-sm text-muted-foreground text-sm">{t('dashboard.empty.body')}</p>
            </div>
          ) : (
            (projects ?? []).map((project) => (
              <Link
                key={project.id}
                to="/app/projects/$projectId"
                params={{ projectId: project.id }}
                className="flex items-center gap-4 rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm"
              >
                <span
                  className="grid size-11 place-items-center rounded-xl text-lg"
                  style={{ backgroundColor: `${project.color}1a`, color: project.color }}
                >
                  ✎
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{project.name}</div>
                  <div className="truncate text-muted-foreground text-sm">
                    {project.description ?? `${t('dashboard.pages', { count: project._count?.pages ?? 0 })} · /${project.slug}`}
                  </div>
                </div>
                <span className="font-mono text-muted-foreground text-xs">{t('dashboard.pages', { count: project._count?.pages ?? 0 })}</span>
              </Link>
            ))
          )}
        </div>

        <TrafficPanel />
      </div>
    </div>
  );
}
