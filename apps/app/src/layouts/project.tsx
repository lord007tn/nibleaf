import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Check, ChevronsUpDown, Eye, Rocket } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { AccountMenu } from '@/components/app/account-menu';
import { DeployPipeline } from '@/components/project/deploy-pipeline';
import { PublishModal } from '@/components/project/publish-modal';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useProject, useProjects } from '@/hooks/api';
import { getData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import type { Deployment, Project } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

const TABS = [
  { labelKey: 'project.overview', to: '/app/projects/$projectId', exact: true },
  { labelKey: 'project.editor', to: '/app/projects/$projectId/editor', exact: false },
  { labelKey: 'project.analytics', to: '/app/projects/$projectId/analytics', exact: false },
  { labelKey: 'project.settings', to: '/app/projects/$projectId/settings', exact: false },
] as const satisfies ReadonlyArray<{ labelKey: MessageKey; to: string; exact: boolean }>;

/** Top-bar status badge + Publish button. Publishing happens through the modal → pipeline flow. */
function PublishControl({ project }: { project: Project }) {
  const [publishOpen, setPublishOpen] = useState(false);
  const [deployOpen, setDeployOpen] = useState(false);
  const t = useT();

  const deployments = useQuery({
    queryKey: queryKeys.deployments.all(project.id),
    queryFn: async () =>
      getData<Deployment[]>(await api.api.app.projects[':projectId'].deployments.$get({ param: { projectId: project.id } }), 'deployments'),
    refetchInterval: (query) => {
      const latest = query.state.data?.[0];
      return latest && (latest.status === 'PENDING' || latest.status === 'BUILDING') ? 1500 : false;
    },
  });
  const latest = deployments.data?.[0];
  const building = latest?.status === 'PENDING' || latest?.status === 'BUILDING';

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" disabled={building} onClick={() => setPublishOpen(true)}>
        <Rocket className="size-3.5" />
        {building ? t('project.publishing') : t('project.publish')}
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
  const t = useT();
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
          {TABS.map((tab) => {
            const active = tab.exact
              ? pathname === `/app/projects/${projectId}`
              : pathname.startsWith(`/app/projects/${projectId}${tab.to.replace('/app/projects/$projectId', '')}`);
            return (
              <Link
                key={tab.labelKey}
                to={tab.to}
                params={{ projectId }}
                className={cn(
                  'rounded-md px-3 py-1.5 font-medium text-sm transition-colors',
                  active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(tab.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          {(projects?.length ?? 0) > 1 ? (
            <Link className="rounded-md px-2.5 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground" to="/app">
              {t('project.allSites')}
            </Link>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            render={
              // biome-ignore lint/a11y/useAnchorContent: content is merged from the Button children via Base UI's render prop
              <a href={`/sites/${projectId}`} target="_blank" rel="noreferrer" aria-label="Preview the live website" />
            }
          >
            <Eye className="size-3.5" /> {t('project.preview')}
          </Button>
          {project ? <PublishControl project={project} /> : null}
          <AccountMenu />
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
