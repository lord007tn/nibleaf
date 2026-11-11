import { Button } from '@nibleaf/design-system/components/ui/button';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
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
export function ConfigSectionList({
  active,
  onSelect,
  only,
}: {
  active: ConfigSectionId;
  onSelect: (id: ConfigSectionId) => void;
  /** Limits the list to these sections, as site settings does (Appearance's own; the rest are pages there). */
  only?: readonly ConfigSectionId[];
}) {
  const t = useT();
  const sections = only ? EDITOR_CONFIG_SECTIONS.filter(({ id }) => only.includes(id)) : EDITOR_CONFIG_SECTIONS;
  return (
    <div className="space-y-0.5">
      {/* "Also available in…" belongs in the editor only, never on the settings page itself (§5.7). */}
      {only ? null : <p className="px-2.5 pb-3 text-muted-foreground text-xs">{t('settings.appearance.location')}</p>}
      {sections.map(({ id, labelKey, icon: Icon }) => (
        <Button
          aria-current={active === id ? 'page' : undefined}
          className={cn(
            'h-9 w-full justify-start gap-2 px-2.5 text-[13.5px]',
            active === id ? 'bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary' : 'text-muted-foreground',
          )}
          key={id}
          onClick={() => onSelect(id)}
          type="button"
          variant="ghost"
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          {t(labelKey)}
        </Button>
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
      // One home for search settings (Settings → Search); this entry points there.
      return <SearchSettingsLink projectId={project.id} />;
    case 'variables':
      return <VariablesSection key={`variables-${project.id}`} project={project} />;
    case 'redirects':
      return <RedirectsSection key={`redirects-${project.id}`} project={project} />;
    default:
      return null;
  }
}

function SearchSettingsLink({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <div className="rounded-xl border border-border bg-card p-5" data-testid="search-settings-link">
      <h2 className="font-semibold">{t('settings.search')}</h2>
      <p className="mt-1 text-muted-foreground text-sm">{t('settings.search.movedHint')}</p>
      <Button
        className="mt-4"
        nativeButton={false}
        render={<Link params={{ projectId }} search={{ section: 'search' }} to="/app/projects/$projectId/settings" />}
        variant="outline"
      >
        {t('settings.search.openSettings')}
      </Button>
    </div>
  );
}
