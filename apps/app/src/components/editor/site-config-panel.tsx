import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import {
  Badge,
  Braces,
  LayoutTemplate,
  type LucideIcon,
  Megaphone,
  Paintbrush,
  PanelBottom,
  PanelTop,
  Route,
  Search,
  SearchCheck,
  Type,
} from 'lucide-react';
import { BannerSection } from '@/components/project-settings/banner-section';
import { BrandingSection } from '@/components/project-settings/branding-section';
import { FooterSection } from '@/components/project-settings/footer-section';
import { NavbarSection } from '@/components/project-settings/navbar-section';
import { RedirectsSection } from '@/components/project-settings/redirects-section';
import { SearchSection } from '@/components/project-settings/search-section';
import { SeoSection } from '@/components/project-settings/seo-section';
import { StylingSection } from '@/components/project-settings/styling-section';
import { ThemeSection } from '@/components/project-settings/theme-section';
import { TypographySection } from '@/components/project-settings/typography-section';
import { VariablesSection } from '@/components/project-settings/variables-section';
import type { Project } from '@/hooks/api';

/**
 * The authoring/appearance slice of a site's configuration, embedded in the
 * full-page editor (brand, theme, navigation, SEO, behaviour). Administration —
 * domain, members, billing, integrations, danger — stays in the Settings hub.
 */
const EDITOR_CONFIG_SECTIONS = [
  { id: 'branding', labelKey: 'settings.branding', icon: Badge },
  { id: 'themes', labelKey: 'settings.themes', icon: LayoutTemplate },
  { id: 'styling', labelKey: 'settings.styling', icon: Paintbrush },
  { id: 'typography', labelKey: 'settings.typography', icon: Type },
  { id: 'navbar', labelKey: 'settings.navbar', icon: PanelTop },
  { id: 'footer', labelKey: 'settings.footer', icon: PanelBottom },
  { id: 'banner', labelKey: 'settings.banner', icon: Megaphone },
  { id: 'seo', labelKey: 'settings.seo', icon: SearchCheck },
  { id: 'search', labelKey: 'settings.search', icon: Search },
  { id: 'variables', labelKey: 'settings.variables', icon: Braces },
  { id: 'redirects', labelKey: 'settings.redirects', icon: Route },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; icon: LucideIcon }>;

export type ConfigSectionId =
  | 'branding'
  | 'themes'
  | 'styling'
  | 'typography'
  | 'navbar'
  | 'footer'
  | 'banner'
  | 'seo'
  | 'search'
  | 'variables'
  | 'redirects';

/** The config section list rendered inside the editor's left rail. */
export function ConfigSectionList({ active, onSelect }: { active: ConfigSectionId; onSelect: (id: ConfigSectionId) => void }) {
  const t = useT();
  return (
    <div className="space-y-0.5">
      {EDITOR_CONFIG_SECTIONS.map(({ id, labelKey, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className={cn(
            'flex h-9 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-start font-medium text-[13.5px] transition-colors',
            active === id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          {t(labelKey)}
        </button>
      ))}
    </div>
  );
}

/** The active config section rendered in the editor's main area. `key` forces a
 *  fresh form instance (correct defaults) per project/section. */
export function ConfigSection({ project, section }: { project: Project; section: ConfigSectionId }) {
  switch (section) {
    case 'branding':
      return <BrandingSection key={`branding-${project.id}`} project={project} />;
    case 'styling':
      return <StylingSection key={`styling-${project.id}`} project={project} />;
    case 'themes':
      return <ThemeSection key={`themes-${project.id}`} project={project} />;
    case 'typography':
      return <TypographySection key={`typography-${project.id}`} project={project} />;
    case 'navbar':
      return <NavbarSection key={`navbar-${project.id}`} project={project} />;
    case 'footer':
      return <FooterSection key={`footer-${project.id}`} project={project} />;
    case 'banner':
      return <BannerSection key={`banner-${project.id}`} project={project} />;
    case 'seo':
      return <SeoSection key={`seo-${project.id}`} project={project} />;
    case 'search':
      return <SearchSection key={`search-${project.id}`} project={project} />;
    case 'variables':
      return <VariablesSection key={`variables-${project.id}`} project={project} />;
    case 'redirects':
      return <RedirectsSection key={`redirects-${project.id}`} project={project} />;
    default:
      return null;
  }
}
