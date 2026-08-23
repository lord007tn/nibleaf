import { Button } from '@nibleaf/design-system/components/ui/button';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import { useT } from '@nibleaf/i18n/react';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { Eye, Rocket } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { NotificationsPopover } from '@/components/app/notifications-popover';
import { ProjectSidebar } from '@/components/app/project-sidebar';
import { DeployPipeline } from '@/components/project/deploy-pipeline';
import { PublishModal } from '@/components/project/publish-modal';
import { useProject } from '@/hooks/api';
import { getData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import type { Deployment, Project } from '@/hooks/api/types';
import { api } from '@/services/api';

/** Top-bar status badge + Publish button. Publishing happens through the modal → pipeline flow.
 *  `initialPublishOpen` opens the publish modal on mount (deep link: editor?publish=true). */
export function PublishControl({ project, initialPublishOpen = false }: { project: Project; initialPublishOpen?: boolean }) {
  const [publishOpen, setPublishOpen] = useState(initialPublishOpen);
  const [deployOpen, setDeployOpen] = useState(false);
  const t = useT();

  const deployments = useQuery({
    queryKey: queryKeys.deployments.all(project.id),
    queryFn: async () =>
      getData<Deployment[]>(await api.app.projects[':projectId'].deployments.$get({ param: { projectId: project.id } }), 'deployments'),
    refetchInterval: (query) => {
      const latest = query.state.data?.[0];
      return latest && (latest.status === 'PENDING' || latest.status === 'BUILDING') ? 1500 : false;
    },
  });
  const latest = deployments.data?.[0];
  const building = latest?.status === 'PENDING' || latest?.status === 'BUILDING';

  return (
    <div className="flex items-center gap-2">
      <Button
        aria-label={building ? t('project.publishing') : t('project.publish')}
        disabled={building}
        onClick={() => setPublishOpen(true)}
        size="sm"
      >
        <Rocket className="size-3.5" />
        <span className="hidden sm:inline">{building ? t('project.publishing') : t('project.publish')}</span>
      </Button>

      <PublishModal onOpenChange={setPublishOpen} onPublished={() => setDeployOpen(true)} open={publishOpen} project={project} />
      <DeployPipeline onOpenChange={setDeployOpen} open={deployOpen} project={project} />
    </div>
  );
}

/** The per-site shell: a left sidebar (switcher + sections + account) with a slim
 *  content header. Publishing lives ONLY in the editor (Mintlify-style); the
 *  dashboard header just offers a live-site preview. */
export function ProjectLayout({ projectId, children }: { projectId: string; children: ReactNode }) {
  const t = useT();
  const { data: project } = useProject(projectId);
  const previewEnabled = project ? project.config?.addons?.previewDeployments !== false : false;
  // The editor is a focused, full-screen workspace (Mintlify-style): it renders
  // its OWN chrome (top bar + page-tree sidebar) and hides the dashboard nav.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.endsWith('/editor')) {
    return <div className="h-screen overflow-hidden">{children}</div>;
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '18rem', '--header-height': '3rem' } as CSSProperties}>
      <ProjectSidebar projectId={projectId} />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-border border-b bg-background/85 px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" />
          {project?.name ? (
            <span className="truncate font-medium text-sm">{project.name}</span>
          ) : (
            <span className="h-4 w-28 animate-pulse rounded bg-muted" aria-hidden />
          )}
          <div className="ms-auto flex items-center gap-2">
            <NotificationsPopover />
            <Button
              nativeButton={false}
              render={
                previewEnabled ? (
                  <Link aria-label="Preview draft website" params={{ projectId }} to="/app/projects/$projectId/preview" />
                ) : (
                  // biome-ignore lint/a11y/useAnchorContent: content is merged from the Button children via Base UI's render prop
                  <a aria-label="Preview the live website" href={`/sites/${projectId}`} rel="noreferrer" target="_blank" />
                )
              }
              size="sm"
              variant="outline"
            >
              <Eye className="size-3.5" /> {t('project.preview')}
            </Button>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
