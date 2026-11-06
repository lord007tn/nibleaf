import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@nibleaf/design-system/components/ui/breadcrumb';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Eye, Loader2, Rocket, Search } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { toast } from 'sonner';
import { useOpenCommandPalette } from '@/components/app/command-palette';
import { NotificationsPopover } from '@/components/app/notifications-popover';
import { ProjectSidebar } from '@/components/app/project-sidebar';
import { DeployPipeline, type PublishPage } from '@/components/project/deploy-pipeline';
import { PublishModal } from '@/components/project/publish-modal';
import { useDeployments, usePendingChanges, useProject } from '@/hooks/api';
import type { Project } from '@/hooks/api/types';
import type { FirstPublishAttribution } from '@/lib/first-publish-activation';

/** Top-bar status badge + Publish button. Publishing happens through the modal → pipeline flow.
 *  `initialPublishOpen` opens the publish modal on mount (deep link: editor?publish=true). */
export function PublishControl({
  project,
  initialPublishOpen = false,
  beforePublish,
  currentPage,
}: {
  project: Project;
  currentPage?: PublishPage;
  initialPublishOpen?: boolean;
  beforePublish?: () => Promise<void> | Promise<boolean>;
}) {
  const [publishOpen, setPublishOpen] = useState(initialPublishOpen);
  const [deployOpen, setDeployOpen] = useState(false);
  const [publishedAttribution, setPublishedAttribution] = useState<FirstPublishAttribution | null>(null);
  const [publishedDeploymentId, setPublishedDeploymentId] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const t = useT();

  const deployments = useDeployments(project.id, { pollIntervalMs: 1500 });
  const pending = usePendingChanges(project.id);
  const changeCount = pending.data?.changes.length ?? 0;
  const latest = deployments.data?.[0];
  const building = latest?.status === 'PENDING' || latest?.status === 'BUILDING';

  return (
    <div className="flex items-center gap-2">
      <Button
        aria-label={building ? t('project.publishing') : t('project.publish')}
        disabled={building || preparing}
        onClick={async () => {
          setPreparing(true);
          try {
            if ((await beforePublish?.()) === false) return;
            setPublishOpen(true);
          } catch {
            toast.error(t('editor.saveError'));
          } finally {
            setPreparing(false);
          }
        }}
        size="sm"
      >
        {preparing ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
        <span>{building ? t('project.publishing') : t('project.publish')}</span>
        {changeCount > 0 ? <span className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">{changeCount}</span> : null}
      </Button>

      <PublishModal
        beforePublish={beforePublish}
        onOpenChange={setPublishOpen}
        onPublished={(deployment, attribution) => {
          setPublishedAttribution(attribution);
          setPublishedDeploymentId(deployment.id);
          setDeployOpen(true);
        }}
        open={publishOpen}
        project={project}
      />
      <DeployPipeline
        currentPage={currentPage}
        onOpenChange={setDeployOpen}
        open={deployOpen}
        project={project}
        onRetry={() => {
          setDeployOpen(false);
          setPublishOpen(true);
        }}
        trackedAttribution={publishedAttribution}
        trackedDeploymentId={publishedDeploymentId}
      />
    </div>
  );
}

/** Breadcrumb label for the site section being viewed (none on the site overview). */
function sectionKeyFromPathname(pathname: string): MessageKey | null {
  if (/\/settings\/?$/.test(pathname)) return 'project.settings';
  if (/\/analytics\/?$/.test(pathname)) return 'project.analytics';
  if (/\/preview\/?$/.test(pathname)) return 'project.preview';
  return null;
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
  const openPalette = useOpenCommandPalette();
  const sectionKey = sectionKeyFromPathname(pathname);
  if (pathname.endsWith('/editor')) {
    return <div className="h-screen overflow-hidden">{children}</div>;
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '18rem', '--header-height': '3rem' } as CSSProperties}>
      <ProjectSidebar projectId={projectId} />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-border border-b bg-background/85 px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" label={t('nav.toggleSidebar')} />
          {/* Where am I: Sites › <site> › <section>, each step a way back. */}
          <Breadcrumb className="min-w-0">
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem className="hidden sm:inline-flex">
                <BreadcrumbLink render={<Link to="/app/sites" />}>{t('nav.sites')}</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:inline-flex" />
              <BreadcrumbItem className="min-w-0">
                {!project?.name ? (
                  <span aria-hidden className="h-4 w-28 animate-pulse rounded bg-muted" />
                ) : sectionKey ? (
                  <BreadcrumbLink className="truncate" dir="auto" render={<Link params={{ projectId }} to="/app/projects/$projectId" />}>
                    {project.name}
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="truncate font-medium" dir="auto">
                    {project.name}
                  </BreadcrumbPage>
                )}
              </BreadcrumbItem>
              {sectionKey ? (
                <>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage className="font-medium">{t(sectionKey)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              ) : null}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ms-auto flex items-center gap-2">
            <Button aria-label={t('command.dialog.title')} onClick={() => openPalette?.()} size="icon-sm" variant="ghost">
              <Search aria-hidden className="size-4" />
            </Button>
            <NotificationsPopover />
            <Button
              nativeButton={false}
              render={
                previewEnabled ? (
                  <Link aria-label={t('project.previewDraftAria')} params={{ projectId }} to="/app/projects/$projectId/preview" />
                ) : (
                  // biome-ignore lint/a11y/useAnchorContent: content is merged from the Button children via Base UI's render prop
                  <a aria-label={t('project.previewLiveAria')} href={`/sites/${projectId}`} rel="noreferrer" target="_blank" />
                )
              }
              size="sm"
              variant="outline"
            >
              <Eye className="size-3.5" /> {t('project.preview')}
            </Button>
          </div>
        </header>
        <div className="flex-1 outline-none" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
