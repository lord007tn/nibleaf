import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  Archive,
  Bell,
  Blocks,
  Braces,
  ChartNoAxesCombined,
  CirclePlus,
  Gem,
  GitBranch,
  Globe2,
  Import,
  Languages,
  LockKeyhole,
  type LucideIcon,
  Plug,
  Search,
  TriangleAlert,
  Users,
} from 'lucide-react';
import type { ReactNode } from 'react';
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
import { GitTab } from '@/components/settings/git-tab';
import { ImportTab } from '@/components/settings/import-tab';
import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { NotificationsTab } from '@/components/settings/notifications-tab';
import { UsageTab } from '@/components/settings/usage-tab';
import type { Project } from '@/hooks/api';
import { useProject } from '@/hooks/api';

// Site settings = the ADMIN/operational slice. The docs-website appearance
// (branding, styling, navbar, footer, banner, SEO, search, redirects, variables)
// lives in the editor's Configuration tab — Mintlify keeps the two separate.
type SettingsGroupId = 'site' | 'deployment' | 'workspace' | 'advanced';

type SectionId =
  | 'general'
  | 'languages'
  | 'domain'
  | 'authentication'
  | 'search'
  | 'addons'
  | 'git'
  | 'openapi'
  | 'contentImport'
  | 'members'
  | 'plan'
  | 'usage'
  | 'integrations'
  | 'notifications'
  | 'exports'
  | 'danger';

const GROUPS = [
  { id: 'site', labelKey: 'settings.group.site' },
  { id: 'deployment', labelKey: 'settings.group.deployment' },
  { id: 'workspace', labelKey: 'settings.group.workspace' },
  { id: 'advanced', labelKey: 'settings.group.advanced' },
] as const satisfies ReadonlyArray<{ id: SettingsGroupId; labelKey: MessageKey }>;

const SECTIONS = [
  { id: 'general', group: 'site', icon: CirclePlus },
  { id: 'languages', group: 'site', icon: Languages },
  { id: 'domain', group: 'site', icon: Globe2 },
  { id: 'authentication', group: 'site', icon: LockKeyhole },
  { id: 'search', group: 'site', icon: Search },
  { id: 'addons', group: 'site', icon: Blocks },
  { id: 'git', group: 'deployment', icon: GitBranch },
  { id: 'openapi', group: 'deployment', icon: Braces },
  { id: 'contentImport', group: 'deployment', icon: Import },
  { id: 'members', group: 'workspace', icon: Users },
  // 'apiKeys' is intentionally hidden: no API route mounts requireApiKey yet, so
  // keys can't be used anywhere. Restore the entry (and the ApiKeysTab wiring in
  // ActiveSection) once a content API actually accepts them.
  { id: 'plan', group: 'workspace', icon: Gem },
  { id: 'usage', group: 'workspace', icon: ChartNoAxesCombined },
  { id: 'integrations', group: 'workspace', icon: Plug },
  { id: 'notifications', group: 'workspace', icon: Bell },
  { id: 'exports', group: 'advanced', icon: Archive },
  { id: 'danger', group: 'advanced', icon: TriangleAlert },
] as const satisfies ReadonlyArray<{ id: SectionId; group: SettingsGroupId; icon: LucideIcon }>;

const isSectionId = (value: unknown): value is SectionId => SECTIONS.some((section) => section.id === value);

export const Route = createFileRoute('/app/projects/$projectId/settings')({
  component: ProjectSettingsPage,
  validateSearch: (search: Record<string, unknown>): { section: SectionId } => ({
    // Analytics moved under Integrations — keep old ?section=analytics links working.
    section: isSectionId(search.section) ? search.section : search.section === 'analytics' ? 'integrations' : 'general',
  }),
});

function ProjectSettingsPage() {
  const { projectId } = Route.useParams();
  const { section } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: project, isLoading } = useProject(projectId);
  const t = useT();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-background md:flex-row">
      <div className="shrink-0 border-border border-b bg-card px-4 py-3 md:hidden">
        <label className="mb-1.5 block font-semibold text-[10.5px] text-muted-foreground uppercase tracking-wider" htmlFor="mobile-settings-section">
          {t('settings.heading')}
        </label>
        <select
          aria-label={t('settings.heading')}
          className="h-10 w-full rounded-lg border border-input bg-background px-3 font-medium text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          id="mobile-settings-section"
          onChange={(event) => navigate({ search: { section: event.target.value as SectionId }, replace: true })}
          value={section}
        >
          {GROUPS.map((group) => (
            <optgroup key={group.id} label={t(group.labelKey)}>
              {SECTIONS.filter((item) => item.group === group.id).map((item) => (
                <option key={item.id} value={item.id}>
                  {t(`settings.${item.id}` as MessageKey)}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <aside className="hidden w-[238px] shrink-0 overflow-y-auto border-border border-e bg-card px-3 py-4.5 md:block">
        <div className="px-3 pt-1 pb-2.5 font-bold text-[11px] text-muted-foreground uppercase tracking-wider">{t('settings.heading')}</div>
        <nav className="flex flex-col gap-0.5">
          {GROUPS.map((group) => (
            <div key={group.id} className="mt-3 first:mt-0">
              <div className="px-3 pb-1 font-semibold text-[10.5px] text-muted-foreground/70 uppercase tracking-wider">{t(group.labelKey)}</div>
              {SECTIONS.filter((item) => item.group === group.id).map((item) => {
                const active = item.id === section;
                const Icon = item.icon;
                return (
                  <button
                    className={cn(
                      'flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-start font-medium text-[13.5px] outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50',
                      active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    key={item.id}
                    onClick={() => navigate({ search: { section: item.id }, replace: true })}
                    type="button"
                  >
                    <Icon aria-hidden className="size-4 shrink-0" />
                    {t(`settings.${item.id}` as MessageKey)}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full px-4 pt-6 pb-24 sm:px-6 md:px-9 md:pt-8 md:pb-32">
          {isLoading || !project ? <SectionSkeleton /> : <ActiveSection projectId={projectId} project={project} section={section} />}
        </div>
      </div>
    </div>
  );
}

function ActiveSection({ project, section, projectId }: { project: Project; section: SectionId; projectId: string }) {
  // `key` forces a fresh form instance (with the right defaults) per project/section.
  const sections: Record<SectionId, ReactNode> = {
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
    plan: <PlanSection key={`plan-${project.id}`} project={project} />,
    usage: <UsageTab key={`usage-${project.id}`} project={project} />,
    integrations: <IntegrationsTab key={`integrations-${projectId}`} projectId={projectId} project={project} />,
    notifications: <NotificationsTab key={`notifications-${projectId}`} projectId={projectId} />,
    exports: <ExportsSection key={`exports-${projectId}`} projectId={projectId} />,
    danger: <DangerSection project={project} />,
  };
  return sections[section];
}

function SectionSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-7 w-40" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-[42px] w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-[42px] w-full" />
      </div>
    </div>
  );
}
