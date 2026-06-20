import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Check, ChevronsUpDown, ExternalLink, Rocket } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { DeployPipeline } from '@/components/project/deploy-pipeline';
import { PublishModal } from '@/components/project/publish-modal';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { getData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import type { Deployment, Project } from '@/hooks/api/types';
import { useProject, useProjects } from '@/hooks/api';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const TABS = (id: string) => [
  { label: 'Editor', to: '/app/projects/$projectId', exact: true },
  { label: 'Analytics', to: '/app/projects/$projectId/analytics', exact: false },
  { label: 'Settings', to: '/app/projects/$projectId/settings', exact: false },
];

/** Top-bar status badge + Publish button. Publishing happens through the modal → pipeline flow. */
function PublishControl({ project }: { project: Project }) {
  const [publishOpen, setPublishOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);

  const deployments = useQuery({
    queryKey: queryKeys.deployments.all(project.id),
    queryFn: async () => getData<Deployment[]>(await api.api.app.projects[':projectId'].deployments.$get({ param: { projectId: project.id } }), 'deployments'),
    refetchInterval: (query) => {
      const latest = query.state.data?.[0];
      return latest && (latest.status === 'PENDING' || latest.status === 'BUILDING') ? 1500 : false;
    },
  });
  const latest = deployments.data?.[0];
  const building = latest?.status === 'PENDING' || latest?.status === 'BUILDING';

  return (
    <div className="flex items-center gap-2">
      {latest ? (
        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-mono text-[11px]',
            latest.status === 'READY' && 'bg-primary/10 text-primary',
            building && 'bg-amber-500/10 text-amber-600',
            latest.status === 'FAILED' && 'bg-destructive/10 text-destructive',
          )}
        >
          v{latest.version} · {latest.status.toLowerCase()}
        </span>
      ) : null}
      <Button size="sm" disabled={building} onClick={() => setPublishOpen(true)}>
        <Rocket className="size-3.5" />
        Publish
      </Button>

      <PublishModal project={project} open={publishOpen} onOpenChange={setPublishOpen} onPublished={() => setDeployOpen(true)} />
      <DeployPipeline project={project} open={deployOpen} onOpenChange={setDeployOpen} />
    </div>
  );
}

/** The focused project (editor) chrome: switcher + tabs + view-site + publish. */
export function ProjectLayout({ projectId, children }: { projectId: string; children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: project } = useProject(projectId);
  const { data: projects } = useProjects();
  const navigate = useNavigate();
  const [switcherOpen, setSwitcherOpen] = useState(false);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-border border-b bg-background/85 px-4 backdrop-blur">
        <Link className="flex items-center gap-2 font-semibold tracking-tight" to="/app">
          <span className="grid size-6 place-items-center rounded-md bg-foreground text-background text-xs">✎</span>
        </Link>
        <span className="text-muted-foreground">/</span>
        <DropdownMenu onOpenChange={setSwitcherOpen} open={switcherOpen}>
          <DropdownMenuTrigger
            render={
              <Button size="sm" variant="ghost" className="gap-1.5">
                <span className="font-medium">{project?.name ?? 'Project'}</span>
                <ChevronsUpDown className="size-3.5 text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            {(projects ?? []).map((p) => (
              <DropdownMenuItem key={p.id} onClick={() => navigate({ to: '/app/projects/$projectId', params: { projectId: p.id } })}>
                <span className="flex-1 truncate">{p.name}</span>
                {p.id === projectId ? <Check className="size-3.5 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <nav className="ms-2 flex items-center gap-1">
          {TABS(projectId).map((tab) => {
            const active = tab.exact ? pathname === `/app/projects/${projectId}` : pathname.startsWith(`/app/projects/${projectId}${tab.to.replace('/app/projects/$projectId', '')}`);
            return (
              <Link
                key={tab.label}
                to={tab.to}
                params={{ projectId }}
                className={cn('rounded-md px-3 py-1.5 font-medium text-sm transition-colors', active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <Button size="sm" variant="outline" render={<a href={`/sites/${projectId}`} target="_blank" rel="noreferrer" />}>
            <ExternalLink className="size-3.5" /> View site
          </Button>
          {project ? <PublishControl project={project} /> : null}
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
