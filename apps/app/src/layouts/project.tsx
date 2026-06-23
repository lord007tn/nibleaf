import { useQuery } from '@tanstack/react-query';
import { Eye, Rocket } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { ProjectSidebar } from '@/components/app/project-sidebar';
import { DeployPipeline } from '@/components/project/deploy-pipeline';
import { PublishModal } from '@/components/project/publish-modal';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { useProject } from '@/hooks/api';
import { getData } from '@/hooks/api/client-helpers';
import { queryKeys } from '@/hooks/api/query-keys';
import type { Deployment, Project } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { useT } from '@/lib/i18n';

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
      <Button disabled={building} onClick={() => setPublishOpen(true)} size="sm">
        <Rocket className="size-3.5" />
        {building ? t('project.publishing') : t('project.publish')}
      </Button>

      <PublishModal onOpenChange={setPublishOpen} onPublished={() => setDeployOpen(true)} open={publishOpen} project={project} />
      <DeployPipeline onOpenChange={setDeployOpen} open={deployOpen} project={project} />
    </div>
  );
}

/** The per-site shell: a left sidebar (switcher + sections + account) with a slim
 *  content header carrying the Preview + Publish actions. */
export function ProjectLayout({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { data: project } = useProject(projectId);
  const t = useT();

  return (
    <SidebarProvider>
      <ProjectSidebar projectId={projectId} />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-border border-b bg-background/85 px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" />
          <Separator className="me-1 data-[orientation=vertical]:h-4" orientation="vertical" />
          <span className="truncate font-medium text-sm">{project?.name ?? ''}</span>
          <div className="ms-auto flex items-center gap-2">
            <Button
              render={
                // biome-ignore lint/a11y/useAnchorContent: content is merged from the Button children via Base UI's render prop
                <a aria-label="Preview the live website" href={`/sites/${projectId}`} rel="noreferrer" target="_blank" />
              }
              size="sm"
              variant="outline"
            >
              <Eye className="size-3.5" /> {t('project.preview')}
            </Button>
            {project ? <PublishControl project={project} /> : null}
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
