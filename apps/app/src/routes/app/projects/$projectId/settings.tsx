import { Button } from '@nibleaf/design-system/components/ui/button';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { canAdminister } from '@nibleaf/shared/rbac';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  Bell,
  Blocks,
  Bot,
  Braces,
  ChartNoAxesCombined,
  CirclePlus,
  Gem,
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
  TriangleAlert,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { ConfigSection, type ConfigSectionId, ConfigSectionList } from '@/components/editor/site-config-panel';
import { AddonsSection } from '@/components/project-settings/addons-section';
import { AuthenticationSection } from '@/components/project-settings/authentication-section';
import { DangerSection } from '@/components/project-settings/danger-section';
import { DomainSection } from '@/components/project-settings/domain-section';
import { ExportsSection } from '@/components/project-settings/exports-section';
import { GeneralSection } from '@/components/project-settings/general-section';
import { LanguagesSection } from '@/components/project-settings/languages-section';
import { MembersSection } from '@/components/project-settings/members-section';
import { OpenApiSection } from '@/components/project-settings/openapi-section';
import { PlanSection } from '@/components/project-settings/plan-section';
import { SearchSection } from '@/components/project-settings/search-section';
import {
  ConfigDirtyProvider,
  DirtyStateReporter,
  SettingsFormSkeleton,
  useConfirmSettingsDiscard,
  useDirtySources,
  useSettingsDirtyGuard,
} from '@/components/project-settings/shared';
import { SmartAiSection } from '@/components/project-settings/smart-ai-section';
import { QueryErrorState } from '@/components/query-error-state';
import { ApiKeysTab } from '@/components/settings/api-keys-tab';
import { GitTab } from '@/components/settings/git-tab';
import { ImportTab } from '@/components/settings/import-tab';
import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { NotificationsTab } from '@/components/settings/notifications-tab';
import { UsageTab } from '@/components/settings/usage-tab';
import type { Project } from '@/hooks/api';
import { useProject, useProjectMembers } from '@/hooks/api';
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
  workspaceAiQueryOptions,
  workspaceSettingsQueryOptions,
} from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { useSession } from '@/services/auth-client';

// Site settings = the ADMIN/operational slice. The docs-website appearance
// (branding, styling, navbar, footer, banner, SEO, search, redirects, variables)
// lives in the editor's Configuration tab — Mintlify keeps the two separate.
type SettingsGroupId = 'site' | 'deployment' | 'workspace' | 'advanced';

// Section ids alone, in nav order. `validateSearch` is part of the router's
// eager chunk, which published docs pages load, so it checks ids here instead
// of reading SECTIONS and pulling in every section icon.
const SECTION_IDS = [
  'general',
  'appearance',
  'languages',
  'domain',
  'authentication',
  'search',
  'addons',
  'git',
  'openapi',
  'contentImport',
  'members',
  'apiKeys',
  'plan',
  'usage',
  'integrations',
  'smartAi',
  'notifications',
  'exports',
  'danger',
] as const;

type SectionId = (typeof SECTION_IDS)[number];

const GROUPS = [
  { id: 'site', labelKey: 'settings.group.site' },
  { id: 'deployment', labelKey: 'settings.group.deployment' },
  { id: 'workspace', labelKey: 'settings.group.workspace' },
  { id: 'advanced', labelKey: 'settings.group.advanced' },
] as const satisfies ReadonlyArray<{ id: SettingsGroupId; labelKey: MessageKey }>;

const SECTIONS = [
  { id: 'general', group: 'site', icon: CirclePlus },
  { id: 'appearance', group: 'site', icon: Palette },
  { id: 'languages', group: 'site', icon: Languages },
  { id: 'domain', group: 'site', icon: Globe2 },
  { id: 'authentication', group: 'site', icon: LockKeyhole },
  { id: 'search', group: 'site', icon: Search },
  { id: 'addons', group: 'site', icon: Blocks },
  { id: 'git', group: 'deployment', icon: GitBranch },
  { id: 'openapi', group: 'deployment', icon: Braces },
  { id: 'contentImport', group: 'deployment', icon: Import },
  { id: 'members', group: 'workspace', icon: Users },
  { id: 'apiKeys', group: 'workspace', icon: KeyRound },
  { id: 'plan', group: 'workspace', icon: Gem },
  { id: 'usage', group: 'workspace', icon: ChartNoAxesCombined },
  { id: 'integrations', group: 'workspace', icon: Plug },
  { id: 'smartAi', group: 'workspace', icon: Bot },
  { id: 'notifications', group: 'workspace', icon: Bell },
  { id: 'exports', group: 'advanced', icon: Archive },
  { id: 'danger', group: 'advanced', icon: TriangleAlert },
] as const satisfies ReadonlyArray<{ id: SectionId; group: SettingsGroupId; icon: LucideIcon }>;

const sectionLabelKey = (id: SectionId): MessageKey => (id === 'appearance' ? 'settings.tab.appearance' : `settings.${id}`);

const isSectionId = (value: unknown): value is SectionId => (SECTION_IDS as readonly unknown[]).includes(value);
// Content languages, team visibility, usage and one-time exports are available
// to editors. The other sections write operational settings guarded by ADMIN.
const EDITOR_SECTIONS = new Set<SectionId>(['languages', 'members', 'usage', 'exports', 'apiKeys']);

export const Route = createFileRoute('/app/projects/$projectId/settings')({
  validateSearch: (search: Record<string, unknown>): { section?: SectionId } => ({
    // Analytics moved under Integrations — keep old ?section=analytics links working.
    section: isSectionId(search.section) ? search.section : search.section === 'analytics' ? 'integrations' : undefined,
  }),
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
      case 'notifications':
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
      case 'smartAi':
        prefetchRouteData(queryClient, workspaceAiQueryOptions(projectId));
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
  const { section: requestedSection } = Route.useSearch();
  const section = requestedSection ?? 'general';
  const navigate = useNavigate({ from: Route.fullPath });
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
  const canManage = canAdminister(currentMember?.role ?? '');
  const availableSections = SECTIONS.filter((item) => canManage || EDITOR_SECTIONS.has(item.id));
  const sectionItems = availableSections.map((item) => ({
    value: item.id,
    label: t(sectionLabelKey(item.id)),
  }));
  const sectionAllowed = canManage || EDITOR_SECTIONS.has(section);

  // Only the default entry chooses a section by role. Explicit locked links
  // retain their permission explanation instead of silently changing destination.
  const redirectSection = availableSections[0]?.id;
  useEffect(() => {
    if (!membersPending && !membersUnavailable && !sessionPending && currentMember && !requestedSection && !sectionAllowed && redirectSection) {
      void navigate({ search: { section: redirectSection }, replace: true });
    }
  }, [membersPending, membersUnavailable, sessionPending, currentMember, sectionAllowed, redirectSection, requestedSection, navigate]);

  if (membersUnavailable) {
    return (
      <div className="p-6">
        <QueryErrorState onRetry={() => void retryMembers()} retrying={membersFetching} />
      </div>
    );
  }

  if (membersPending || sessionPending || (currentMember && !requestedSection && !sectionAllowed)) {
    return (
      <div className="p-6">
        <SettingsFormSkeleton />
      </div>
    );
  }

  return (
    <ConfigDirtyProvider report={reportDirty}>
      <div className="flex h-[calc(100vh-3.5rem)] min-w-0 flex-col overflow-hidden bg-background md:flex-row">
        <div className="shrink-0 border-border border-b bg-card px-4 py-3 md:hidden">
          <label
            className="mb-1.5 block font-semibold text-[10.5px] text-muted-foreground uppercase tracking-wider"
            htmlFor="mobile-settings-section"
          >
            {t('settings.heading')}
          </label>
          <Select
            items={sectionItems}
            onValueChange={(next) => navigate({ search: { section: (next ?? section) as SectionId }, replace: true })}
            value={sectionAllowed ? section : ''}
          >
            <SelectTrigger aria-label={t('settings.heading')} className="h-10 w-full rounded-lg font-medium" id="mobile-settings-section">
              <SelectValue placeholder={t('settings.heading')} />
            </SelectTrigger>
            <SelectContent>
              {GROUPS.filter((group) => availableSections.some((item) => item.group === group.id)).map((group) => (
                <SelectGroup key={group.id}>
                  <SelectLabel>{t(group.labelKey)}</SelectLabel>
                  {availableSections
                    .filter((item) => item.group === group.id)
                    .map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {t(sectionLabelKey(item.id))}
                      </SelectItem>
                    ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <aside className="hidden w-[238px] shrink-0 overflow-y-auto border-border border-e bg-card px-3 py-4.5 md:block">
          <div className="px-3 pt-1 pb-2.5 font-bold text-[11px] text-muted-foreground uppercase tracking-wider">{t('settings.heading')}</div>
          <nav className="flex flex-col gap-0.5">
            {GROUPS.filter((group) => availableSections.some((item) => item.group === group.id)).map((group) => (
              <div key={group.id} className="mt-3 first:mt-0">
                <div className="px-3 pb-1 font-semibold text-[10.5px] text-muted-foreground/70 uppercase tracking-wider">{t(group.labelKey)}</div>
                {availableSections
                  .filter((item) => item.group === group.id)
                  .map((item) => {
                    const active = item.id === section;
                    const Icon = item.icon;
                    return (
                      <Button
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'h-9 w-full justify-start gap-2 rounded-lg px-3 text-[13.5px]',
                          active ? 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary' : 'text-muted-foreground',
                        )}
                        key={item.id}
                        onClick={() => navigate({ search: { section: item.id }, replace: true })}
                        type="button"
                        variant="ghost"
                      >
                        <Icon aria-hidden className="size-4 shrink-0" />
                        {t(sectionLabelKey(item.id))}
                      </Button>
                    );
                  })}
              </div>
            ))}
          </nav>
        </aside>

        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-6xl px-4 pt-6 pb-24 sm:px-6 md:px-9 md:pt-8 md:pb-32">
            {projectPending ? (
              <SettingsFormSkeleton />
            ) : projectError || !project ? (
              <QueryErrorState onRetry={() => void retryProject()} retrying={projectFetching} />
            ) : !sectionAllowed ? (
              <div className="rounded-xl border border-border bg-card p-6" role="status">
                <h2 className="font-semibold text-lg">{t('settings.permissions.title')}</h2>
                <p className="mt-2 text-muted-foreground text-sm">{t('settings.permissions.body')}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    nativeButton={false}
                    render={
                      <Link params={{ projectId }} search={{ section: redirectSection ?? 'languages' }} to="/app/projects/$projectId/settings" />
                    }
                    variant="outline"
                  >
                    {t(sectionLabelKey(redirectSection ?? 'languages'))}
                  </Button>
                  <Button nativeButton={false} render={<Link params={{ projectId }} to="/app/projects/$projectId/editor" />}>
                    {t('project.editor')}
                  </Button>
                </div>
              </div>
            ) : (
              <ActiveSection
                canManageSchedules={canManage}
                projectId={projectId}
                project={project}
                role={currentMember?.role ?? ''}
                section={section}
              />
            )}
          </div>
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
  role,
}: {
  project: Project;
  section: SectionId;
  projectId: string;
  canManageSchedules: boolean;
  role: string;
}) {
  // `key` forces a fresh form instance (with the right defaults) per project/section.
  const sections: Record<SectionId, ReactNode> = {
    appearance: <SiteAppearance key={project.id} project={project} />,
    general: <GeneralSection key={`general-${project.id}`} project={project} />,
    languages: <LanguagesSection key={`languages-${project.id}`} project={project} />,
    domain: <DomainSection key={`domain-${projectId}`} project={project} />,
    authentication: <AuthenticationSection key={`authentication-${project.id}`} project={project} />,
    search: <SearchSection key={`search-${project.id}`} project={project} />,
    addons: <AddonsSection key={`addons-${project.id}`} projectId={project.id} />,
    git: <GitTab key={`git-${projectId}`} projectId={projectId} />,
    openapi: <OpenApiSection key={`openapi-${projectId}`} projectId={projectId} />,
    contentImport: <ImportTab key={`import-${projectId}`} projectId={projectId} />,
    members: <MembersSection key={`members-${projectId}`} projectId={projectId} />,
    apiKeys: <ApiKeysTab role={role} key={`api-keys-${projectId}`} projectId={projectId} />,
    plan: <PlanSection key={`plan-${project.id}`} project={project} />,
    usage: <UsageTab key={`usage-${project.id}`} project={project} />,
    integrations: <IntegrationsTab key={`integrations-${projectId}`} projectId={projectId} project={project} />,
    smartAi: <SmartAiSection key={`smart-ai-${projectId}`} project={project} />,
    notifications: <NotificationsTab key={`notifications-${projectId}`} projectId={projectId} />,
    exports: <ExportsSection canManageSchedules={canManageSchedules} key={`exports-${projectId}`} projectId={projectId} />,
    danger: <DangerSection project={project} />,
  };
  const wideSection = section === 'general' || section === 'usage' || section === 'integrations' || section === 'exports';
  return <div className={cn('w-full', wideSection ? 'max-w-6xl' : 'max-w-4xl')}>{sections[section]}</div>;
}

function SiteAppearance({ project }: { project: Project }) {
  const confirmDiscard = useConfirmSettingsDiscard();
  const [section, setSection] = useState<ConfigSectionId>('branding');
  // Report to the route as well as guarding the local appearance section picker.
  const { sources, report } = useDirtySources();
  return (
    <>
      <DirtyStateReporter dirty={sources.size > 0} />
      <div className="mb-6">
        <ConfigSectionList
          active={section}
          onSelect={async (next) => {
            if (next === section) return;
            if (sources.size > 0 && !(await confirmDiscard())) return;
            setSection(next);
          }}
        />
      </div>
      <ConfigDirtyProvider report={report}>
        <ConfigSection project={project} section={section} />
      </ConfigDirtyProvider>
    </>
  );
}
