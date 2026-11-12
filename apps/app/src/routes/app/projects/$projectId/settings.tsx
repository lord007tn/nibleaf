import { Button } from '@nibleaf/design-system/components/ui/button';
import { PageContainer } from '@nibleaf/design-system/components/ui/page-container';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { canAdminister, canEdit } from '@nibleaf/shared/rbac';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  ArrowLeftRight,
  Blocks,
  Bot,
  Braces,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  GitBranch,
  Globe2,
  Import,
  KeyRound,
  Languages,
  LockKeyhole,
  type LucideIcon,
  Palette,
  Plug,
  Search,
  SearchCheck,
  TriangleAlert,
  Users,
  Variable,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { ConfigSection, ConfigSectionList } from '@/components/editor/site-config-panel';
import { AddonsSection } from '@/components/project-settings/addons-section';
import { AuthenticationSection } from '@/components/project-settings/authentication-section';
import { DangerSection } from '@/components/project-settings/danger-section';
import { DomainSection } from '@/components/project-settings/domain-section';
import { ExportsSection } from '@/components/project-settings/exports-section';
import { GeneralSection } from '@/components/project-settings/general-section';
import { LanguagesSection } from '@/components/project-settings/languages-section';
import { OpenApiSection } from '@/components/project-settings/openapi-section';
import { SearchSection } from '@/components/project-settings/search-section';
import {
  ConfigDirtyProvider,
  DirtyStateReporter,
  SettingsFormSkeleton,
  useDirtySources,
  useSettingsDirtyGuard,
} from '@/components/project-settings/shared';
import { QueryErrorState } from '@/components/query-error-state';
import { GitTab } from '@/components/settings/git-tab';
import { ImportTab } from '@/components/settings/import-tab';
import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { UsageTab } from '@/components/settings/usage-tab';
import { AiAssistantsPage } from '@/features/ai-assistants/components/ai-assistants-page';
import { SiteTeamPage } from '@/features/people/components/site-team-page';
import { siteAiQueryOptions } from '@/features/site-ai/api/query-options';
import { AiAnswersPage } from '@/features/site-ai/components/ai-answers-page';
import {
  APPEARANCE_SECTION_IDS,
  type AppearanceSectionId,
  isMovedSectionId,
  type MovedSectionId,
  parseSettingsSearch,
  type SectionId,
} from '@/features/site-settings/model/ids';
import { type SettingsAccess, sectionAllowed, sectionLabelKey, settingsNav, WIDE_SECTIONS } from '@/features/site-settings/model/sections';
import type { Project } from '@/hooks/api';
import { type SwitcherOrganization, useOrganizationOfProject, useProject, useProjectMembers } from '@/hooks/api';
import {
  apiKeysQueryOptions,
  branchesQueryOptions,
  connectedAppsQueryOptions,
  deploymentsQueryOptions,
  domainsQueryOptions,
  gitWorkflowQueryOptions,
  integrationsQueryOptions,
  languagesQueryOptions,
  listExportRunsQueryOptions,
  listExportSchedulesQueryOptions,
  openApiConfigurationQueryOptions,
  pagesQueryOptions,
  projectAddonsQueryOptions,
  projectMembersQueryOptions,
  projectQueryOptions,
  projectUsageQueryOptions,
  readerAccessQueryOptions,
  workspaceSettingsQueryOptions,
} from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { useSession } from '@/services/auth-client';

// Site settings (operations/ui-overhaul.md §5.7): two levels, the app sidebar
// and one settings nav whose every item is a page. Ids and URL parsing live in
// features/site-settings/model (the router's eager chunk loads them); the
// icons stay here, with the page.
const SECTION_ICONS: Record<SectionId, LucideIcon> = {
  general: CirclePlus,
  appearance: Palette,
  languages: Languages,
  domain: Globe2,
  authentication: LockKeyhole,
  addons: Blocks,
  seo: SearchCheck,
  redirects: ArrowLeftRight,
  variables: Variable,
  search: Search,
  git: GitBranch,
  openapi: Braces,
  contentImport: Import,
  exports: Archive,
  ai: Bot,
  apiKeys: KeyRound,
  integrations: Plug,
  members: Users,
  usage: ChartNoAxesCombined,
  danger: TriangleAlert,
};

export const Route = createFileRoute('/app/projects/$projectId/settings')({
  // Old links keep working: Analytics opens Integrations, and Appearance's former
  // SEO, Redirects, Variables and Search subsections open their own pages.
  validateSearch: parseSettingsSearch,
  loaderDeps: ({ search }) => ({ section: search.section }),
  loader: ({ context: { queryClient }, params: { projectId }, deps: { section } }) => {
    prefetchRouteData(queryClient, projectQueryOptions(projectId));
    prefetchRouteData(queryClient, projectMembersQueryOptions(projectId));
    switch (section ?? 'general') {
      case 'general':
      case 'appearance':
      case 'languages':
        prefetchRouteData(queryClient, languagesQueryOptions(projectId));
        break;
      case 'domain':
        prefetchRouteData(queryClient, domainsQueryOptions(projectId));
        break;
      case 'addons':
        prefetchRouteData(queryClient, projectAddonsQueryOptions(projectId));
        break;
      case 'openapi':
        prefetchRouteData(queryClient, openApiConfigurationQueryOptions(projectId));
        break;
      case 'usage':
        prefetchRouteData(queryClient, projectUsageQueryOptions(projectId));
        break;
      case 'contentImport':
        prefetchRouteData(queryClient, workspaceSettingsQueryOptions(projectId));
        break;
      case 'git':
        prefetchRouteData(queryClient, workspaceSettingsQueryOptions(projectId));
        prefetchRouteData(queryClient, branchesQueryOptions(projectId));
        prefetchRouteData(queryClient, languagesQueryOptions(projectId));
        prefetchRouteData(queryClient, deploymentsQueryOptions(projectId));
        prefetchRouteData(queryClient, gitWorkflowQueryOptions(projectId));
        break;
      case 'authentication':
        prefetchRouteData(queryClient, readerAccessQueryOptions(projectId));
        prefetchRouteData(queryClient, pagesQueryOptions(projectId));
        break;
      case 'integrations':
        prefetchRouteData(queryClient, integrationsQueryOptions(projectId));
        break;
      case 'ai':
        prefetchRouteData(queryClient, siteAiQueryOptions(projectId));
        break;
      case 'apiKeys':
        prefetchRouteData(queryClient, apiKeysQueryOptions(projectId));
        prefetchRouteData(queryClient, connectedAppsQueryOptions(projectId));
        break;
      case 'exports':
        prefetchRouteData(queryClient, listExportRunsQueryOptions(projectId));
        prefetchRouteData(queryClient, listExportSchedulesQueryOptions(projectId));
        prefetchRouteData(queryClient, deploymentsQueryOptions(projectId));
        break;
      case 'search':
        prefetchRouteData(queryClient, languagesQueryOptions(projectId));
        // These factories parse with validators schemas, so they load lazily to
        // stay out of the main chunk. If the chunk fails, the section fetches on render.
        if (typeof window !== 'undefined')
          void import('@/hooks/api/project-search')
            .then((search) => {
              prefetchRouteData(queryClient, search.projectSearchConfigurationQueryOptions(projectId));
              prefetchRouteData(queryClient, search.projectSearchIndexDiagnosticsQueryOptions(projectId));
            })
            .catch(() => undefined);
        break;
      default:
        break;
    }
  },
  component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
  const reportDirty = useSettingsDirtyGuard();
  const { projectId } = Route.useParams();
  const { section: requestedOrMoved, appearanceSection } = Route.useSearch();
  // Plan and Notifications moved to the organization: an old link shows a pointer under Usage.
  const movedSection = isMovedSectionId(requestedOrMoved) ? requestedOrMoved : undefined;
  const requestedSection = isMovedSectionId(requestedOrMoved) ? 'usage' : requestedOrMoved;
  const {
    data: project,
    isPending: projectPending,
    isError: projectError,
    isFetching: projectFetching,
    refetch: retryProject,
  } = useProject(projectId);
  const {
    data: memberData,
    isPending: membersPending,
    isError: membersError,
    isFetching: membersFetching,
    refetch: retryMembers,
  } = useProjectMembers(projectId);
  const membersUnavailable = membersError && !memberData;
  const { data: session, isPending: sessionPending } = useSession();
  const t = useT();
  const currentMember = memberData?.members.find((member) => member.user.id === session?.user.id);
  const { organization } = useOrganizationOfProject(project?.organizationId);
  const access: SettingsAccess = {
    canManage: canAdminister(currentMember?.role ?? ''),
    canEditContent: canEdit(currentMember?.role ?? ''),
    orgAdmin: organization ? organization.orgRole !== 'member' : false,
  };
  const nav = settingsNav(access);
  const firstAllowed = nav[0]?.sections[0];
  // Only the default entry picks a page by role. An explicit link to a page
  // this person can't open keeps its explanation instead of changing page.
  const section: SectionId = requestedSection ?? (sectionAllowed('general', access) ? 'general' : (firstAllowed ?? 'general'));
  const allowed = sectionAllowed(section, access);
  // On a phone, /settings with no page is the list of pages; each page links back to it.
  const listPage = !requestedSection;
  // Where the person is: the list or a page they opened. It changes only when
  // they navigate, never when permissions resolve the default entry's page.
  const place = requestedSection ?? 'list';

  const contentRef = useRef<HTMLDivElement>(null);
  const navHeadingRef = useRef<HTMLHeadingElement>(null);
  const shownPlace = useRef(place);
  useEffect(() => {
    if (shownPlace.current === place) return;
    shownPlace.current = place;
    // Moving to a page focuses its heading, and back to the list focuses the
    // list's heading, so keyboard and screen reader users start at the top of
    // what they opened. A page's heading can mount after its data loads.
    const target = () => (place === 'list' ? navHeadingRef.current : contentRef.current?.querySelector<HTMLElement>('h1, h2'));
    const focus = () => {
      const heading = target();
      if (!heading) return false;
      if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
      heading.focus();
      return true;
    };
    if (focus() || !contentRef.current) return;
    const observer = new MutationObserver(() => {
      if (focus()) observer.disconnect();
    });
    observer.observe(contentRef.current, { childList: true, subtree: true });
    const stop = setTimeout(() => observer.disconnect(), 10_000);
    return () => {
      observer.disconnect();
      clearTimeout(stop);
    };
  }, [place]);

  if (membersUnavailable) {
    return (
      <div className="p-6">
        <QueryErrorState onRetry={() => void retryMembers()} retrying={membersFetching} />
      </div>
    );
  }

  if (membersPending || sessionPending) {
    return (
      <div className="p-6">
        <SettingsFormSkeleton />
      </div>
    );
  }

  return (
    <ConfigDirtyProvider report={reportDirty}>
      <div className="flex min-w-0 flex-col bg-background md:min-h-[calc(100dvh-3rem)] md:flex-row">
        {/* The column runs the page's full height; the nav inside it sticks below the 3rem site header and is
            at most the viewport less the header and the inset layout's 0.5rem bottom margin, so it never
            slides under the header at the end of the page. */}
        <div className={cn('w-full shrink-0 bg-card md:w-60 md:border-border md:border-e', !listPage && 'hidden md:block')}>
          <nav aria-label={t('settings.title')} className="px-3 py-4 md:sticky md:top-12 md:max-h-[calc(100dvh-3.5rem)] md:overflow-y-auto">
            <h2 className="px-3 pb-3 font-semibold text-base outline-none md:text-sm" ref={navHeadingRef}>
              {t('settings.title')}
            </h2>
            {nav.map((group) => (
              <div className="mt-4 first-of-type:mt-0" key={group.id}>
                {group.labelKey ? (
                  <h3 className="px-3 pb-1 font-medium text-muted-foreground text-xs">{t(group.labelKey)}</h3>
                ) : (
                  <div aria-hidden className="mx-3 mb-3 border-border border-t" />
                )}
                <ul className="flex flex-col gap-0.5">
                  {group.sections.map((id) => {
                    const active = id === section;
                    const Icon = SECTION_ICONS[id];
                    return (
                      <li key={id}>
                        <Link
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex h-11 items-center gap-2.5 rounded-lg px-3 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9',
                            active
                              ? // The list page on a phone shows no current page; the desktop nav does.
                                listPage
                                ? 'text-muted-foreground hover:text-foreground md:bg-primary/10 md:font-medium md:text-primary'
                                : 'bg-primary/10 font-medium text-primary hover:bg-primary/10'
                              : 'text-muted-foreground hover:text-foreground',
                            id === 'danger' && 'text-destructive hover:text-destructive',
                          )}
                          params={{ projectId }}
                          search={{ section: id }}
                          to="/app/projects/$projectId/settings"
                        >
                          <Icon aria-hidden className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{t(sectionLabelKey(id))}</span>
                          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground md:hidden rtl:rotate-180" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className={cn('min-w-0 flex-1 outline-none', listPage && 'hidden md:block')} ref={contentRef} tabIndex={-1}>
          <PageContainer width={WIDE_SECTIONS.has(section) ? 'wide' : 'default'}>
            <Link
              className="-ms-1 -mb-4 inline-flex items-center gap-1 self-start rounded-md px-1 py-1 text-muted-foreground text-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 md:hidden"
              params={{ projectId }}
              search={{}}
              to="/app/projects/$projectId/settings"
            >
              <ChevronLeft aria-hidden className="size-4 rtl:rotate-180" />
              {t('settings.backToAll')}
            </Link>
            {projectPending ? (
              <SettingsFormSkeleton />
            ) : projectError || !project ? (
              <QueryErrorState onRetry={() => void retryProject()} retrying={projectFetching} />
            ) : !allowed ? (
              <div className="rounded-xl border border-border bg-card p-6" role="status">
                <h2 className="font-semibold text-lg">{t('settings.permissions.title')}</h2>
                <p className="mt-2 text-muted-foreground text-sm">
                  {t(
                    // Deleting the website is the organization's call, whatever the site role (§4.2).
                    section === 'danger'
                      ? 'settings.permissions.dangerBody'
                      : access.canEditContent
                        ? 'settings.permissions.body'
                        : 'settings.permissions.viewerBody',
                  )}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    nativeButton={false}
                    render={<Link params={{ projectId }} search={{ section: firstAllowed ?? 'languages' }} to="/app/projects/$projectId/settings" />}
                    variant="outline"
                  >
                    {t(sectionLabelKey(firstAllowed ?? 'languages'))}
                  </Button>
                  <Button nativeButton={false} render={<Link params={{ projectId }} to="/app/projects/$projectId/editor" />}>
                    {t(access.canEditContent ? 'project.editor' : 'overview.viewPages')}
                  </Button>
                </div>
              </div>
            ) : (
              <ActiveSection
                appearanceSection={appearanceSection}
                // Entering the list (or another page) starts the page afresh, so a
                // draft discarded on the way out is really gone.
                key={place}
                canCreateExports={access.canEditContent}
                canManageSchedules={access.canManage}
                movedSection={movedSection}
                organization={organization}
                project={project}
                projectId={projectId}
                role={currentMember?.role ?? ''}
                section={section}
              />
            )}
          </PageContainer>
        </div>
      </div>
    </ConfigDirtyProvider>
  );
}

function ActiveSection({
  project,
  section,
  projectId,
  canManageSchedules,
  canCreateExports,
  role,
  appearanceSection,
  movedSection,
  organization,
}: {
  project: Project;
  section: SectionId;
  movedSection?: MovedSectionId;
  organization?: SwitcherOrganization;
  projectId: string;
  canManageSchedules: boolean;
  canCreateExports: boolean;
  role: string;
  appearanceSection?: AppearanceSectionId;
}) {
  // `key` forces a fresh form instance (with the right defaults) per project/section.
  const sections: Record<SectionId, ReactNode> = {
    appearance: <SiteAppearance key={project.id} project={project} section={appearanceSection ?? 'branding'} />,
    general: <GeneralSection key={`general-${project.id}`} project={project} />,
    languages: <LanguagesSection key={`languages-${project.id}`} project={project} />,
    domain: <DomainSection key={`domain-${projectId}`} project={project} />,
    authentication: <AuthenticationSection key={`authentication-${project.id}`} project={project} />,
    search: <SearchSection key={`search-${project.id}`} project={project} />,
    seo: <ConfigPage key={`seo-${project.id}`} project={project} section="seo" />,
    redirects: <ConfigPage key={`redirects-${project.id}`} project={project} section="redirects" />,
    variables: <ConfigPage key={`variables-${project.id}`} project={project} section="variables" />,
    addons: <AddonsSection key={`addons-${project.id}`} projectId={project.id} />,
    git: <GitTab key={`git-${projectId}`} projectId={projectId} />,
    openapi: <OpenApiSection key={`openapi-${projectId}`} projectId={projectId} />,
    contentImport: <ImportTab key={`import-${projectId}`} projectId={projectId} />,
    members: <SiteTeamPage key={`members-${projectId}`} organization={organization} projectId={projectId} siteName={project.name} />,
    apiKeys: <AiAssistantsPage key={`api-keys-${projectId}`} projectId={projectId} role={role} siteName={project.name} />,
    usage: (
      <>
        {movedSection ? <MovedSectionNotice organization={organization} section={movedSection} /> : null}
        <UsageTab
          key={`usage-${project.id}`}
          organization={organization ? { slug: organization.slug, name: organization.name, canManage: organization.orgRole !== 'member' } : undefined}
          project={project}
        />
      </>
    ),
    integrations: <IntegrationsTab key={`integrations-${projectId}`} projectId={projectId} project={project} />,
    ai: <AiAnswersPage key={`ai-${projectId}`} project={project} />,
    exports: (
      <ExportsSection canCreate={canCreateExports} canManageSchedules={canManageSchedules} key={`exports-${projectId}`} projectId={projectId} />
    ),
    danger: <DangerSection organization={organization} project={project} />,
  };
  return <div className="w-full min-w-0">{sections[section]}</div>;
}

/** Where Plan and Notifications went (§5.2): a one-line pointer for old links and habits. */
function MovedSectionNotice({ section, organization }: { section: MovedSectionId; organization?: SwitcherOrganization }) {
  const t = useT();
  const canManage = organization ? organization.orgRole !== 'member' : false;
  return (
    <p className="mb-4 rounded-lg border border-border bg-muted/30 p-3 text-sm" data-moved-section={section} role="status">
      {section === 'plan' ? t('settings.moved.plan') : t('settings.moved.notifications')}{' '}
      {section === 'notifications' ? (
        <Link className="font-medium text-primary underline-offset-4 hover:underline" search={{ tab: 'notifications' }} to="/app/settings">
          {t('settings.moved.notificationsLink')}
        </Link>
      ) : organization && canManage ? (
        <Link
          className="font-medium text-primary underline-offset-4 hover:underline"
          params={{ orgSlug: organization.slug }}
          to="/app/o/$orgSlug/billing"
        >
          <bdi>{organization.name}</bdi>
        </Link>
      ) : organization ? (
        <bdi className="font-medium">{organization.name}</bdi>
      ) : null}
    </p>
  );
}

/** A page that edits one part of the site's configuration (SEO, Redirects, Variables), as the editor's Configuration tab does. */
function ConfigPage({ project, section }: { project: Project; section: 'seo' | 'redirects' | 'variables' }) {
  const { sources, report } = useDirtySources();
  return (
    <>
      <DirtyStateReporter dirty={sources.size > 0} />
      <ConfigDirtyProvider report={report}>
        <ConfigSection project={project} section={section} />
      </ConfigDirtyProvider>
    </>
  );
}

function SiteAppearance({ project, section }: { project: Project; section: AppearanceSectionId }) {
  const navigate = useNavigate({ from: Route.fullPath });
  // Subsection navigation uses the route's existing unsaved-change guard.
  const { sources, report } = useDirtySources();
  return (
    <>
      <DirtyStateReporter dirty={sources.size > 0} />
      <div className="mb-6">
        <ConfigSectionList
          active={section}
          onSelect={(next) => {
            if (next === section) return;
            void navigate({ search: { section: 'appearance', appearanceSection: next as AppearanceSectionId } });
          }}
          only={APPEARANCE_SECTION_IDS}
        />
      </div>
      <ConfigDirtyProvider report={report}>
        <ConfigSection project={project} section={section} />
      </ConfigDirtyProvider>
    </>
  );
}
