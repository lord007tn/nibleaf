import { Button } from '@nibleaf/design-system/components/ui/button';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { Braces, type LucideIcon, Palette, Route, Search, SearchCheck } from 'lucide-react';
import { AppearancePage } from '@/features/site-appearance/components/appearance-page';
import { RedirectsSettings as RedirectsSection } from '@/features/site-redirects/components/redirects-settings';
import { SeoSettings as SeoSection } from '@/features/site-seo/components/seo-settings';
import { VariablesSettings as VariablesSection } from '@/features/site-variables/components/variables-settings';
import type { Project } from '@/hooks/api';

/**
 * The authoring/appearance slice of a site's configuration, embedded in the
 * full-page editor: the one Appearance page (brand, theme, type, header,
 * footer and banner) and the Content pages. Administration (domain, members,
 * billing, integrations, danger) stays in the Settings hub.
 */
const EDITOR_CONFIG_SECTIONS = [
  { id: 'appearance', labelKey: 'settings.tab.appearance', icon: Palette },
  { id: 'seo', labelKey: 'settings.seo', icon: SearchCheck },
  { id: 'search', labelKey: 'settings.search', icon: Search },
  { id: 'variables', labelKey: 'settings.variables', icon: Braces },
  { id: 'redirects', labelKey: 'settings.redirects', icon: Route },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; icon: LucideIcon }>;

export type ConfigSectionId = (typeof EDITOR_CONFIG_SECTIONS)[number]['id'];

/** The editor's Configuration panel list, in its left rail. */
export function ConfigSectionList({ active, onSelect }: { active: ConfigSectionId; onSelect: (id: ConfigSectionId) => void }) {
  const t = useT();
  return (
    <div className="space-y-0.5">
      <p className="px-2.5 pb-3 text-muted-foreground text-xs">{t('settings.appearance.location')}</p>
      {EDITOR_CONFIG_SECTIONS.map(({ id, labelKey, icon: Icon }) => (
        <Button
          aria-current={active === id ? 'page' : undefined}
          className={cn(
            'h-9 w-full justify-start gap-2 px-2.5 text-sm',
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
    case 'appearance':
      return <AppearancePage host="editor" key={`appearance-${project.id}`} project={project} />;
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
