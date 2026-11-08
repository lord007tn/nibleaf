import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useTheme } from '@nibleaf/design-system/theme';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  BarChart3,
  BookOpen,
  BookText,
  FileText,
  Globe2,
  Home,
  Languages,
  type LucideIcon,
  Moon,
  PenLine,
  Plus,
  Settings,
  SlidersHorizontal,
  Sun,
  UserPlus,
  Users,
} from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { InterfaceLanguageDialog } from '@/components/interface-language-dialog';
import { usePages, useProjects } from '@/hooks/api';

/** Site-settings destinations people look for most, with English aliases so
 *  "domain", "team" or "language" find them whatever the label says. */
const SETTINGS_DESTINATIONS = [
  { section: 'general', labelKey: 'settings.general', icon: SlidersHorizontal, aliases: 'general name logo seo' },
  { section: 'domain', labelKey: 'settings.domain', icon: Globe2, aliases: 'domain address url web dns' },
  { section: 'languages', labelKey: 'settings.languages', icon: Languages, aliases: 'languages translation arabic rtl' },
  { section: 'members', labelKey: 'settings.members', icon: Users, aliases: 'members team people invite roles' },
] as const satisfies ReadonlyArray<{ section: string; labelKey: MessageKey; icon: LucideIcon; aliases: string }>;

/** Pages listed before the user types (most recently edited first). */
const RECENT_PAGE_LIMIT = 6;

const CommandPaletteContext = createContext<(() => void) | null>(null);

/** Opens the app-wide palette; null outside the signed-in app shell. */
export const useOpenCommandPalette = () => useContext(CommandPaletteContext);

/**
 * Mounted once for the whole signed-in app (routes/app/route.tsx), so Ctrl/⌘+K
 * works on every screen, including the editor and site settings.
 */
export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openPalette = useMemo(() => () => setOpen(true), []);
  return (
    <CommandPaletteContext.Provider value={openPalette}>
      {children}
      <CommandPalette onOpenChange={setOpen} open={open} />
    </CommandPaletteContext.Provider>
  );
}

const PALETTE_SKELETON_ROWS = ['a', 'b', 'c'];

/** A results group still loading: its heading over item-shaped placeholder rows. */
function PaletteLoadingRows({ heading }: { heading: string }) {
  const t = useT();
  return (
    <div aria-busy="true" className="p-1">
      <p className="px-2 py-1.5 font-medium text-muted-foreground text-xs">{heading}</p>
      <p className="sr-only" role="status">
        {t('common.loading')}
      </p>
      {PALETTE_SKELETON_ROWS.map((row) => (
        <div aria-hidden className="flex h-9 items-center gap-2 px-2" key={row}>
          <Skeleton className="size-4 shrink-0 rounded-sm" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const navigate = useNavigate();
  // Mounted above the site routes, so read the site from the deepest match.
  const projectId = useRouterState({ select: (state) => (state.matches.at(-1)?.params as { projectId?: string } | undefined)?.projectId });
  const { data: projects, isPending: projectsPending } = useProjects();
  // Only fetch the current site's pages once the palette is actually open.
  const { data: pages, isPending: pagesQueryPending } = usePages(open ? projectId : undefined);
  // A disabled query (no site, palette closed) is also "pending"; only a real first load counts.
  const pagesPending = Boolean(open && projectId) && pagesQueryPending;
  const { resolvedTheme, setTheme } = useTheme();
  const [query, setQuery] = useState('');
  const [languageOpen, setLanguageOpen] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A focused widget that already claimed the shortcut keeps it.
      if (event.defaultPrevented) return;
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey) && !event.altKey) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  const currentSite = projectId ? projects?.find((project) => project.id === projectId) : undefined;
  const searching = query.trim().length > 0;
  const pageItems = useMemo(() => {
    const list = (pages ?? []).filter((page) => page.kind === 'PAGE');
    if (searching) return list;
    return [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, RECENT_PAGE_LIMIT);
  }, [pages, searching]);
  // Inside a site, its settings; elsewhere, every site's settings once the user searches.
  const settingsSites = projectId ? (currentSite ? [currentSite] : []) : searching ? (projects ?? []) : [];

  const changeOpen = (next: boolean) => {
    if (!next) setQuery('');
    onOpenChange(next);
  };
  const go = (to: string, params?: Record<string, string>, search?: Record<string, unknown>) => {
    changeOpen(false);
    navigate({ to, params, search } as never);
  };

  return (
    <>
      <CommandDialog description={t('command.dialog.description')} onOpenChange={changeOpen} open={open} title={t('command.dialog.title')}>
        <CommandInput onValueChange={setQuery} placeholder={t('command.searchPlaceholder')} value={query} />
        <CommandList>
          {/* While sites or pages are still loading, a miss isn't "no results" yet. */}
          {projectsPending || pagesPending ? null : <CommandEmpty>{t('command.noResults')}</CommandEmpty>}
          {pagesPending ? <PaletteLoadingRows heading={t('command.group.pages')} /> : null}
          {projectsPending ? <PaletteLoadingRows heading={t('command.group.projects')} /> : null}
          {projectId && pageItems.length > 0 ? (
            <CommandGroup heading={t('command.group.pages')}>
              {pageItems.map((page) => {
                const title = page.config?.sidebarTitle?.trim() || page.title;
                return (
                  <CommandItem
                    key={page.id}
                    keywords={[title, page.slug]}
                    onSelect={() => go('/app/projects/$projectId/editor', { projectId }, { page: page.id })}
                    value={`page ${page.id}`}
                  >
                    <FileText className="size-4" />
                    <span className="truncate" dir="auto">
                      {title}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ) : null}
          <CommandGroup heading={t('command.group.projects')}>
            {(projects ?? []).map((project) => (
              <CommandItem
                key={project.id}
                value={`project ${project.name}`}
                onSelect={() => go('/app/projects/$projectId', { projectId: project.id })}
              >
                <BookText className="size-4" />
                <span className="truncate" dir="auto">
                  {project.name}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
          {settingsSites.length > 0 ? (
            <CommandGroup heading={t('command.group.settings')}>
              {settingsSites.flatMap((site) =>
                SETTINGS_DESTINATIONS.map((destination) => {
                  const label = t(destination.labelKey);
                  return (
                    <CommandItem
                      key={`${site.id}-${destination.section}`}
                      keywords={[label, site.name, t('command.group.settings')]}
                      onSelect={() => go('/app/projects/$projectId/settings', { projectId: site.id }, { section: destination.section })}
                      value={`settings ${site.id} ${destination.aliases}`}
                    >
                      <destination.icon className="size-4" />
                      <span className="flex-1 truncate">{label}</span>
                      {projectId ? null : (
                        <span className="max-w-[45%] truncate text-muted-foreground text-xs" dir="auto">
                          {site.name}
                        </span>
                      )}
                    </CommandItem>
                  );
                }),
              )}
            </CommandGroup>
          ) : null}
          <CommandGroup heading={t('command.group.actions')}>
            {projectId ? (
              <>
                <CommandItem
                  keywords={[t('overview.openEditor')]}
                  onSelect={() => go('/app/projects/$projectId/editor', { projectId })}
                  value="open editor write"
                >
                  <PenLine className="size-4" /> {t('overview.openEditor')}
                </CommandItem>
                <CommandItem
                  keywords={[t('command.invite')]}
                  onSelect={() => go('/app/projects/$projectId/settings', { projectId }, { section: 'members' })}
                  value="invite people teammate"
                >
                  <UserPlus className="size-4" /> {t('command.invite')}
                </CommandItem>
              </>
            ) : null}
            <CommandItem
              keywords={[t('dashboard.newProject')]}
              onSelect={() => go('/app/sites', undefined, { newSite: true })}
              value="new site create"
            >
              <Plus className="size-4" /> {t('dashboard.newProject')}
            </CommandItem>
            <CommandItem
              keywords={[t('account.language')]}
              onSelect={() => {
                changeOpen(false);
                setLanguageOpen(true);
              }}
              value="switch interface language"
            >
              <Languages className="size-4" /> {t('account.language')}
            </CommandItem>
            <CommandItem
              keywords={[t(resolvedTheme === 'dark' ? 'account.lightMode' : 'account.darkMode')]}
              onSelect={() => {
                changeOpen(false);
                setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
              }}
              value="toggle dark light mode theme"
            >
              {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {t(resolvedTheme === 'dark' ? 'account.lightMode' : 'account.darkMode')}
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t('command.group.goTo')}>
            {/* cmdk matches the query against `value`/`keywords`, never the rendered
                label, so the localized label must be a keyword to be searchable. */}
            <CommandItem value="projects" keywords={[t('command.allProjects')]} onSelect={() => go('/app')}>
              <Home className="size-4" /> {t('command.allProjects')}
            </CommandItem>
            <CommandItem value="sites" keywords={[t('nav.sites')]} onSelect={() => go('/app/sites')}>
              <BookOpen className="size-4" /> {t('nav.sites')}
            </CommandItem>
            <CommandItem value="people" keywords={[t('nav.people'), 'members team invite roles']} onSelect={() => go('/app/people')}>
              <Users className="size-4" /> {t('nav.people')}
            </CommandItem>
            <CommandItem value="analytics" keywords={[t('command.analytics')]} onSelect={() => go('/app/analytics')}>
              <BarChart3 className="size-4" /> {t('command.analytics')}
            </CommandItem>
            <CommandItem value="settings" keywords={[t('command.accountSettings')]} onSelect={() => go('/app/settings')}>
              <Settings className="size-4" /> {t('command.accountSettings')}
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
      <InterfaceLanguageDialog onOpenChange={setLanguageOpen} open={languageOpen} />
    </>
  );
}
