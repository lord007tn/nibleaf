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
import { Eye, Rocket } from 'lucide-react';
import { type CSSProperties, Fragment, type ReactNode, useId, useState } from 'react';
import { toast } from 'sonner';
import { NotificationsPopover } from '@/components/app/notifications-popover';
import { OrganizationSwitcher } from '@/components/app/org-switcher/organization-switcher';
import { WebsiteSwitcher } from '@/components/app/org-switcher/website-switcher';
import { ProjectSidebar } from '@/components/app/project-sidebar';
import { ShellSearchButton } from '@/components/app/shell-search-button';
import { DeployPipeline, type PublishPage } from '@/components/project/deploy-pipeline';
import { PublishModal } from '@/components/project/publish-modal';
import { useDeployments, useOrganizationOfProject, usePendingChanges, useProject } from '@/hooks/api';
import type { Project } from '@/hooks/api/types';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { useRecordVisitEffect } from '@/hooks/use-record-visit';
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
  const countId = useId();
  // Only someone known to be able to edit can publish. Viewers see the button
  // disabled with the reason on hover; while the role loads or can't be read it
  // stays disabled too. A deep link (?publish=true) waits for edit access, and a
  // Viewer's request is dropped so a later role change never opens it by surprise.
  const editAccess = useProjectAdminStatus(project.id).edit;
  const canPublish = editAccess === 'edit';
  const viewOnly = editAccess === 'viewOnly';
  if (publishOpen && viewOnly) setPublishOpen(false);

  const deployments = useDeployments(project.id, { pollIntervalMs: 1500 });
  const pending = usePendingChanges(project.id);
  const changeCount = pending.data?.changes.length ?? 0;
  const latest = deployments.data?.[0];
  const building = latest?.status === 'PENDING' || latest?.status === 'BUILDING';
  // The number on the button is the site's unpublished-change count. Say what it
  // means on hover, and to keyboard and screen-reader users as the description.
  const countLabel = changeCount > 0 ? t('editor.unpublishedCount', { count: changeCount }) : undefined;

  return (
    <div className="flex items-center gap-2">
      <Button
        aria-describedby={countLabel ? countId : undefined}
        aria-label={building ? t('project.publishing') : t('project.publish')}
        disabled={building || !canPublish}
        loading={preparing}
        title={
          viewOnly
            ? t('access.viewOnly.publish')
            : editAccess === 'edit'
              ? countLabel
              : t(editAccess === 'unknown' ? 'access.unknown.title' : 'access.checking.publish')
        }
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
        <Rocket className="size-3.5" />
        <span>{building ? t('project.publishing') : t('project.publish')}</span>
        {changeCount > 0 ? (
          <span aria-hidden className="rounded-full bg-primary-foreground/20 px-1.5 text-xs tabular-nums">
            {changeCount}
          </span>
        ) : null}
      </Button>
      {countLabel ? (
        <span className="sr-only" id={countId}>
          {countLabel}
        </span>
      ) : null}

      <PublishModal
        beforePublish={beforePublish}
        onOpenChange={setPublishOpen}
        onPublished={(deployment, attribution) => {
          setPublishedAttribution(attribution);
          setPublishedDeploymentId(deployment.id);
          setDeployOpen(true);
        }}
        open={publishOpen && canPublish}
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

/** Every non-editor project route, including each analytics child. */
const ANALYTICS_SECTIONS: Record<string, MessageKey> = {
  pages: 'analytics.tab.pages',
  search: 'analytics.tab.search',
  feedback: 'analytics.tab.feedback',
  ai: 'analytics.tab.ai',
  performance: 'analytics.tab.performance',
};

function sectionKeysFromPathname(pathname: string): MessageKey[] {
  const [, section, child] = pathname.match(/^\/app\/projects\/[^/]+(?:\/([^/]+))?(?:\/([^/]+))?\/?$/) ?? [];
  if (section === 'analytics') {
    const childKey = child ? ANALYTICS_SECTIONS[child] : undefined;
    return childKey ? ['project.analytics', childKey] : ['project.analytics'];
  }
  if (section === 'ai') return ['dashboard.ai.title'];
  if (section === 'settings') return ['project.settings'];
  if (section === 'preview') return ['project.preview'];
  return [];
}

/** The per-site shell: a left sidebar (switcher + sections + account) with a slim
 *  content header. Publishing lives ONLY in the editor (Mintlify-style); the
 *  dashboard header just offers a live-site preview. */
export function ProjectLayout({ projectId, children }: { projectId: string; children: ReactNode }) {
  const t = useT();
  const { data: project } = useProject(projectId);
  // The website implies its org (§5.4.2): the switcher shows it and it becomes the last org.
  const { organization } = useOrganizationOfProject(project?.organizationId);
  useRecordVisitEffect({ projectId: project ? projectId : undefined });
  const previewEnabled = project ? project.config?.addons?.previewDeployments !== false : false;
  // The editor is a focused, full-screen workspace (Mintlify-style): it renders
  // its OWN chrome (top bar + page-tree sidebar) and hides the dashboard nav.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const sectionKeys = sectionKeysFromPathname(pathname);
  // The draft preview marks its own article area as the skip target, past its page list.
  const pageOwnsSkipTarget = /\/preview\/?$/.test(pathname);
  if (pathname.endsWith('/editor')) {
    return <div className="h-screen overflow-hidden">{children}</div>;
  }

  return (
    <SidebarProvider style={{ '--sidebar-width': '18rem', '--header-height': '3rem' } as CSSProperties}>
      <ProjectSidebar orgSlug={organization?.slug} projectId={projectId} />
      <SidebarInset as="div">
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center min-w-0 gap-2 border-border border-b bg-background/80 px-3 sm:px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" label={t('nav.toggleSidebar')} />
          {/* Where am I: [Org ▾] / [Website ▾] / Section (§5.2). Org and website are switchers. */}
          <Breadcrumb aria-label={t('nav.breadcrumb')} className="min-w-0 flex-1">
            <BreadcrumbList className="flex-nowrap gap-1 sm:gap-1">
              <BreadcrumbItem className="min-w-0 shrink">
                {/* Phones keep the org as its avatar only, so the website name has room. */}
                <OrganizationSwitcher collapseName currentProjectId={projectId} organization={organization} />
              </BreadcrumbItem>
              <BreadcrumbSeparator className="shrink-0" />
              <BreadcrumbItem className="min-w-0 shrink">
                <WebsiteSwitcher organization={organization} project={project ? { id: project.id, name: project.name } : undefined} />
              </BreadcrumbItem>
              {sectionKeys.map((key, index) => {
                const current = index === sectionKeys.length - 1;
                return (
                  <Fragment key={key}>
                    <BreadcrumbSeparator className={current ? 'hidden shrink-0 sm:inline-flex' : 'hidden lg:inline-flex'} />
                    <BreadcrumbItem className={current ? 'hidden min-w-0 sm:inline-flex' : 'hidden min-w-0 shrink-0 lg:inline-flex'}>
                      {current ? (
                        <BreadcrumbPage className="truncate font-medium">{t(key)}</BreadcrumbPage>
                      ) : (
                        <BreadcrumbLink
                          render={<Link activeOptions={{ exact: true }} params={{ projectId }} to="/app/projects/$projectId/analytics" />}
                        >
                          {t(key)}
                        </BreadcrumbLink>
                      )}
                    </BreadcrumbItem>
                  </Fragment>
                );
              })}
            </BreadcrumbList>
          </Breadcrumb>
          <div className="ms-auto flex shrink-0 items-center gap-2">
            <ShellSearchButton />
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
              <Eye aria-hidden className="size-3.5" /> <span className="hidden sm:inline">{t('project.preview')}</span>
            </Button>
          </div>
        </header>
        {/* The page's one main landmark, after the header. The draft preview puts
            the skip target on its own article area instead. */}
        <main className="flex-1 outline-none" id={pageOwnsSkipTarget ? undefined : 'main-content'} tabIndex={pageOwnsSkipTarget ? undefined : -1}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
