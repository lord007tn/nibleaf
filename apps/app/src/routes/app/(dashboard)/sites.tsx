import { NibleafMark } from '@nibleaf/design-system/brand';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowUpRight, FileText, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NewProjectDialog } from '@/components/app/new-project-dialog';
import { useProjects } from '@/hooks/api';
import { useFormatters } from '@/lib/format';

export const Route = createFileRoute('/app/(dashboard)/sites')({
  component: SitesPage,
  validateSearch: (search: Record<string, unknown>): { newSite?: boolean } =>
    search.newSite === true || search.newSite === 'true' ? { newSite: true } : {},
});

function SitesPage() {
  const { newSite } = Route.useSearch();
  const { data: projects, isPending } = useProjects();
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(Boolean(newSite));
  const navigate = useNavigate();
  const t = useT();
  const { number } = useFormatters();
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized ? (projects ?? []).filter((project) => `${project.name} ${project.slug}`.toLowerCase().includes(normalized)) : (projects ?? []);
  }, [projects, query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">{t('project.allSites')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('dashboard.subtitle')}</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="size-4.5" /> {t('dashboard.newProject')}
        </Button>
      </div>
      <div className="relative max-w-md">
        <Search className="absolute start-3 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="ps-10" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('dashboard.search.placeholder')} />
      </div>
      {isPending ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : filtered.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((project) => (
            <button
              type="button"
              key={project.id}
              onClick={() => navigate({ to: '/app/projects/$projectId', params: { projectId: project.id } })}
              className="group cursor-pointer rounded-xl border border-border bg-card p-5 text-start transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-11 place-items-center rounded-xl border border-border bg-muted/50">
                  <NibleafMark className="size-7" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{project.name}</span>
                  <span className="block truncate font-mono text-muted-foreground text-xs">/{project.slug}</span>
                </span>
                <ArrowUpRight className="size-4.5 text-muted-foreground transition group-hover:text-primary rtl:-scale-x-100" />
              </div>
              <div className="mt-8 flex items-center gap-2 text-muted-foreground text-sm">
                <FileText className="size-4" /> {t('dashboard.pages', { count: number(project._count?.pages ?? 0) })}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border text-center">
          <div>
            <NibleafMark className="mx-auto size-9" />
            <p className="mt-3 font-medium">{t('dashboard.empty.title')}</p>
            <Button className="mt-4" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> {t('dashboard.empty.cta')}
            </Button>
          </div>
        </div>
      )}
      <NewProjectDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
