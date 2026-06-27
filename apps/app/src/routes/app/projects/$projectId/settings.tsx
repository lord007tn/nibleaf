import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AnalyticsSection } from '@/components/project-settings/analytics-section';
import { DangerSection } from '@/components/project-settings/danger-section';
import { DomainSection } from '@/components/project-settings/domain-section';
import { GeneralSection } from '@/components/project-settings/general-section';
import { MembersSection } from '@/components/project-settings/members-section';
import { PlanSection } from '@/components/project-settings/plan-section';
import { BillingTab } from '@/components/settings/billing-tab';
import { GitTab } from '@/components/settings/git-tab';
import { IntegrationsTab } from '@/components/settings/integrations-tab';
import { NotificationsTab } from '@/components/settings/notifications-tab';
import { Skeleton } from '@/components/ui/skeleton';
import type { Project } from '@/hooks/api';
import { useProject } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { cn } from '@/lib/utils';

// Site settings = the ADMIN/operational slice. The docs-website appearance
// (branding, styling, navbar, footer, banner, SEO, search, redirects, variables)
// lives in the editor's Configuration tab — Mintlify keeps the two separate.
const GROUPS = [
  { id: 'site', labelKey: 'settings.group.site' },
  { id: 'deployment', labelKey: 'settings.group.deployment' },
  { id: 'workspace', labelKey: 'settings.group.workspace' },
  { id: 'advanced', labelKey: 'settings.group.advanced' },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey }>;

const SECTIONS = [
  { id: 'general', group: 'site', icon: '⊕' },
  { id: 'domain', group: 'site', icon: '◷' },
  { id: 'analytics', group: 'site', icon: '◴' },
  { id: 'git', group: 'deployment', icon: '⎇' },
  { id: 'members', group: 'workspace', icon: '⧉' },
  { id: 'plan', group: 'workspace', icon: '◇' },
  { id: 'billing', group: 'workspace', icon: '◫' },
  { id: 'integrations', group: 'workspace', icon: '⚙' },
  { id: 'notifications', group: 'workspace', icon: '✉' },
  { id: 'danger', group: 'advanced', icon: '⚠' },
] as const satisfies ReadonlyArray<{ id: string; group: (typeof GROUPS)[number]['id']; icon: string }>;

type SectionId = (typeof SECTIONS)[number]['id'];

const isSectionId = (value: unknown): value is SectionId => SECTIONS.some((section) => section.id === value);

export const Route = createFileRoute('/app/projects/$projectId/settings')({
  component: ProjectSettingsPage,
  validateSearch: (search: Record<string, unknown>): { section: SectionId } => ({
    section: isSectionId(search.section) ? search.section : 'general',
  }),
});

function ProjectSettingsPage() {
  const { projectId } = Route.useParams();
  const { section } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: project, isLoading } = useProject(projectId);
  const t = useT();

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-background">
      <aside className="w-[238px] shrink-0 overflow-y-auto border-border border-e bg-card px-3 py-4.5">
        <div className="px-3 pt-1 pb-2.5 font-bold text-[11px] text-muted-foreground uppercase tracking-wider">{t('settings.heading')}</div>
        <nav className="flex flex-col gap-0.5">
          {GROUPS.map((group) => (
            <div key={group.id} className="mt-3 first:mt-0">
              <div className="px-3 pb-1 font-semibold text-[10.5px] text-muted-foreground/70 uppercase tracking-wider">{t(group.labelKey)}</div>
              {SECTIONS.filter((item) => item.group === group.id).map((item) => {
                const active = item.id === section;
                return (
                  <button
                    className={cn(
                      'flex h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-start font-medium text-[13.5px] transition-colors',
                      active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    key={item.id}
                    onClick={() => navigate({ search: { section: item.id }, replace: true })}
                    type="button"
                  >
                    <span className="inline-flex w-[18px] justify-center text-[13px]">{item.icon}</span>
                    {t(`settings.${item.id}` as MessageKey)}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[660px] px-9 pt-8 pb-32">
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
    domain: <DomainSection key={`domain-${projectId}`} project={project} />,
    analytics: <AnalyticsSection key={`analytics-${project.id}`} project={project} />,
    git: <GitTab key={`git-${projectId}`} projectId={projectId} />,
    members: <MembersSection key={`members-${projectId}`} projectId={projectId} />,
    plan: <PlanSection key={`plan-${project.id}`} project={project} />,
    billing: <BillingTab key={`billing-${projectId}`} projectId={projectId} />,
    integrations: <IntegrationsTab key={`integrations-${projectId}`} projectId={projectId} />,
    notifications: <NotificationsTab key={`notifications-${projectId}`} projectId={projectId} />,
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
