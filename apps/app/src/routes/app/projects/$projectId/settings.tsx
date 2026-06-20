import { createFileRoute, useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AnalyticsSection } from '@/components/project-settings/analytics-section';
import { BannerSection } from '@/components/project-settings/banner-section';
import { BrandingSection } from '@/components/project-settings/branding-section';
import { DangerSection } from '@/components/project-settings/danger-section';
import { DomainSection } from '@/components/project-settings/domain-section';
import { FooterSection } from '@/components/project-settings/footer-section';
import { GeneralSection } from '@/components/project-settings/general-section';
import { MembersSection } from '@/components/project-settings/members-section';
import { NavbarSection } from '@/components/project-settings/navbar-section';
import { RedirectsSection } from '@/components/project-settings/redirects-section';
import { SearchSection } from '@/components/project-settings/search-section';
import { SeoSection } from '@/components/project-settings/seo-section';
import { StylingSection } from '@/components/project-settings/styling-section';
import { TypographySection } from '@/components/project-settings/typography-section';
import { VariablesSection } from '@/components/project-settings/variables-section';
import { Skeleton } from '@/components/ui/skeleton';
import type { Project } from '@/hooks/api';
import { useProject } from '@/hooks/api';
import { cn } from '@/lib/utils';

const SECTIONS = [
  { id: 'general', label: 'General', icon: '⊕' },
  { id: 'branding', label: 'Branding', icon: '▣' },
  { id: 'styling', label: 'Styling', icon: '◐' },
  { id: 'typography', label: 'Typography', icon: 'T' },
  { id: 'navbar', label: 'Navbar', icon: '☰' },
  { id: 'footer', label: 'Footer', icon: '▭' },
  { id: 'banner', label: 'Banner', icon: '⚑' },
  { id: 'seo', label: 'SEO', icon: '◎' },
  { id: 'domain', label: 'Custom domain', icon: '◷' },
  { id: 'search', label: 'Search', icon: '⌕' },
  { id: 'analytics', label: 'Analytics', icon: '◴' },
  { id: 'redirects', label: 'Redirects', icon: '⤳' },
  { id: 'variables', label: 'Variables', icon: '{}' },
  { id: 'members', label: 'Members', icon: '⧉' },
  { id: 'danger', label: 'Danger zone', icon: '⚠' },
] as const;

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

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden bg-background">
      <aside className="w-[238px] shrink-0 overflow-y-auto border-border border-e bg-card px-3 py-4.5">
        <div className="px-3 pt-1 pb-2.5 font-bold text-[11px] text-muted-foreground uppercase tracking-wider">Site configurations</div>
        <nav className="flex flex-col gap-0.5">
          {SECTIONS.map((item) => {
            const active = item.id === section;
            return (
              <button
                className={cn(
                  'flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-start font-medium text-[13.5px] transition-colors',
                  active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
                key={item.id}
                onClick={() => navigate({ search: { section: item.id }, replace: true })}
                type="button"
              >
                <span className="inline-flex w-[18px] justify-center text-[13px]">{item.icon}</span>
                {item.label}
              </button>
            );
          })}
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
    branding: <BrandingSection key={`branding-${project.id}`} project={project} />,
    styling: <StylingSection key={`styling-${project.id}`} project={project} />,
    typography: <TypographySection key={`typography-${project.id}`} project={project} />,
    navbar: <NavbarSection key={`navbar-${project.id}`} project={project} />,
    footer: <FooterSection key={`footer-${project.id}`} project={project} />,
    banner: <BannerSection key={`banner-${project.id}`} project={project} />,
    seo: <SeoSection key={`seo-${project.id}`} project={project} />,
    domain: <DomainSection key={`domain-${projectId}`} project={project} />,
    search: <SearchSection key={`search-${project.id}`} project={project} />,
    analytics: <AnalyticsSection key={`analytics-${project.id}`} project={project} />,
    redirects: <RedirectsSection key={`redirects-${project.id}`} project={project} />,
    variables: <VariablesSection key={`variables-${project.id}`} project={project} />,
    members: <MembersSection />,
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
