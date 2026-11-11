import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  contiguousFirstFilter,
} from '@nibleaf/design-system/components/ui/command';
import { Skeleton } from '@nibleaf/design-system/components/ui/skeleton';
import { useTheme } from '@nibleaf/design-system/theme';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  BookText,
  Building2,
  FileText,
  Globe2,
  Languages,
  type LucideIcon,
  Moon,
  PenLine,
  Plus,
  ReceiptText,
  Settings,
  SlidersHorizontal,
  Sun,
  UserPlus,
  UserRound,
  Users,
} from 'lucide-react';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { InterfaceLanguageDialog } from '@/components/interface-language-dialog';
import { QueryErrorState } from '@/components/query-error-state';
import { useOrganizationSwitcherProjects, usePages, useSwitcher } from '@/hooks/api';
import { OrgAvatar } from './org-switcher/org-avatar';
import { useSwitcherControls } from './org-switcher/switcher-context';

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
  // Scoped to the organization in view (§5.4.5): its websites and pages; other orgs through "Switch organization".
  const controls = useSwitcherControls();
  const switcher = useSwitcher();
  const organizations = switcher.data?.organizations ?? [];
  const organization = organizations.find((org) => org.id === controls?.current.organizationId);
  const projectsQuery = useOrganizationSwitcherProjects(open ? organization?.id : undefined);
  const projects = projectsQuery.data;
  const projectsPending = Boolean(open && organization) && projectsQuery.isPending;
  const orgAdmin = organization ? organization.orgRole !== 'member' : false;
  // Only fetch the current site's pages once the palette is actually open.
  const pagesQuery = usePages(open ? projectId : undefined);
  const { data: pages, isPending: pagesQueryPending } = pagesQuery;
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
  // Inside a site, its settings. Elsewhere, once the user searches, each settings
  // page appears ONCE, for the website opened most recently in this organization
  // (or its first): one "Custom domain", not one per website (audit WORKSPACE-16).
  const recentInOrg = switcher.data?.recent?.find(
    (website) => website.organization.id === organization?.id && projects?.some((p) => p.id === website.id),
  );
  const settingsSite = projectId ? currentSite : searching ? (projects?.find((p) => p.id === recentInOrg?.id) ?? projects?.[0]) : undefined;
  const settingsSites = settingsSite ? [settingsSite] : [];

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
      <CommandDialog
        description={t('command.dialog.description')}
        filter={contiguousFirstFilter}
        onOpenChange={changeOpen}
        open={open}
        title={t('command.dialog.title')}
      >
        <CommandInput
          aria-label={t('command.searchPlaceholder')}
          onValueChange={setQuery}
          placeholder={t('command.searchPlaceholder')}
          value={query}
        />
        {projectsQuery.isError ? (
          <div className="p-2">
            <QueryErrorState title={t('nav.sitesLoadError')} onRetry={() => void projectsQuery.refetch()} retrying={projectsQuery.isFetching} />
          </div>
        ) : null}
        {projectId && pagesQuery.isError ? (
          <div className="p-2">
            <QueryErrorState title={t('command.pagesLoadError')} onRetry={() => void pagesQuery.refetch()} retrying={pagesQuery.isFetching} />
          </div>
        ) : null}
        <CommandList>
          {/* While sites or pages are still loading, a miss isn't "no results" yet. */}
          {projectsPending || pagesPending || projectsQuery.isError || (projectId && pagesQuery.isError) ? null : (
            <CommandEmpty>{t('command.noResults')}</CommandEmpty>
          )}
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
                keywords={[project.name, project.domain ?? '']}
                value={`project ${project.id}`}
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
            {!projectId && organization && orgAdmin ? (
              // Outside a website, inviting is an organization action (its Members page).
              <CommandItem
                keywords={[t('command.invite')]}
                onSelect={() => go('/app/o/$orgSlug/members', { orgSlug: organization.slug })}
                value="invite people teammate members"
              >
                <UserPlus className="size-4" /> {t('command.invite')}
              </CommandItem>
            ) : null}
            <CommandItem
              keywords={[t('command.switchOrganizationOrWebsite')]}
              onSelect={() => {
                changeOpen(false);
                controls?.openSwitcher('organization');
              }}
              value="switch organization website"
            >
              <ArrowLeftRight className="size-4" /> {t('command.switchOrganizationOrWebsite')}
            </CommandItem>
            {organization?.canCreateWebsite ? (
              <CommandItem
                keywords={[t('dashboard.newProject')]}
                onSelect={() => go('/app/o/$orgSlug/websites', { orgSlug: organization.slug }, { newSite: true })}
                value="new site website create"
              >
                <Plus className="size-4" /> {t('dashboard.newProject')}
              </CommandItem>
            ) : null}
            <CommandItem
              keywords={[t('command.createOrganization')]}
              onSelect={() => {
                changeOpen(false);
                controls?.openCreateOrganization();
              }}
              value="create new organization"
            >
              <Building2 className="size-4" /> {t('command.createOrganization')}
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
            {organization ? (
              <>
                <CommandItem
                  keywords={[t('nav.websites')]}
                  onSelect={() => go('/app/o/$orgSlug/websites', { orgSlug: organization.slug })}
                  value="websites sites"
                >
                  <BookOpen className="size-4" /> {t('nav.websites')}
                </CommandItem>
                <CommandItem
                  keywords={[t('command.analytics')]}
                  onSelect={() => go('/app/o/$orgSlug/analytics', { orgSlug: organization.slug })}
                  value="analytics"
                >
                  <BarChart3 className="size-4" /> {t('command.analytics')}
                </CommandItem>
                {orgAdmin ? (
                  <>
                    <CommandItem
                      keywords={[t('nav.members'), 'people team invite roles']}
                      onSelect={() => go('/app/o/$orgSlug/members', { orgSlug: organization.slug })}
                      value="members people"
                    >
                      <Users className="size-4" /> {t('nav.members')}
                    </CommandItem>
                    <CommandItem
                      keywords={[t('nav.billing'), 'plan usage seats']}
                      onSelect={() => go('/app/o/$orgSlug/billing', { orgSlug: organization.slug })}
                      value="billing usage plan"
                    >
                      <ReceiptText className="size-4" /> {t('nav.billing')}
                    </CommandItem>
                  </>
                ) : null}
                <CommandItem
                  keywords={[t('command.organizationSettings')]}
                  onSelect={() => go('/app/o/$orgSlug/settings', { orgSlug: organization.slug })}
                  value="organization settings"
                >
                  <Settings className="size-4" /> {t('command.organizationSettings')}
                </CommandItem>
              </>
            ) : null}
            <CommandItem keywords={[t('command.accountSettings')]} onSelect={() => go('/app/settings')} value="account settings profile">
              <UserRound className="size-4" /> {t('command.accountSettings')}
            </CommandItem>
          </CommandGroup>
          {organizations.length > 1 ? (
            <CommandGroup heading={t('command.group.switchOrganization')}>
              {organizations.map((org) => (
                <CommandItem
                  key={org.id}
                  keywords={[org.name, t('command.group.switchOrganization')]}
                  onSelect={() => go('/app/o/$orgSlug/websites', { orgSlug: org.slug })}
                  value={`organization ${org.id}`}
                >
                  <OrgAvatar className="size-4 text-[8px]" logo={org.logo} name={org.name} />
                  <span className="flex-1 truncate">
                    <bdi>{org.name}</bdi>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}
        </CommandList>
      </CommandDialog>
      <InterfaceLanguageDialog onOpenChange={setLanguageOpen} open={languageOpen} />
    </>
  );
}
