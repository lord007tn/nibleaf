import { NibleafMark } from '@nibleaf/design-system/brand';
import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@nibleaf/design-system/components/ui/sidebar';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
import { useRef, useSyncExternalStore } from 'react';
import { InlineSkeleton } from '@/components/inline-skeleton';
import { useProjects } from '@/hooks/api';

const subscribeToHydration = () => () => undefined;

export function SiteSwitcher({ projectId }: { projectId?: string }) {
  const { data: projects, isPending, isError, isFetching, refetch } = useProjects();
  const { setOpenMobile } = useSidebar();
  const workspaceItem = useRef<HTMLDivElement>(null);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const selected = hydrated ? projects?.find((project) => project.id === projectId) : undefined;
  // Inside a site, don't flash "All sites" while the site list is still loading.
  const nameLoading = Boolean(projectId) && (!hydrated || isPending);
  const navigate = useNavigate();
  const t = useT();
  const go = (navigateTo: () => void) => {
    setOpenMobile(false);
    navigateTo();
  };
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton className="gap-2.5 data-[popup-open]:bg-sidebar-accent data-[popup-open]:text-sidebar-accent-foreground" size="lg" />
            }
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-primary/10">
              {projectId ? <NibleafMark className="size-5.5" /> : <LayoutGrid className="size-4.5 text-sidebar-primary" />}
            </span>
            <span className="min-w-0 flex-1">
              {nameLoading ? (
                <span className="flex flex-col gap-1.5">
                  <span className="sr-only">{t('common.loading')}</span>
                  <InlineSkeleton className="h-4 w-3/4" />
                  <InlineSkeleton className="h-3 w-1/3" />
                </span>
              ) : (
                <>
                  {/* bdi isolates a Latin site name without left-aligning it in RTL. */}
                  <span className="block truncate text-start font-semibold text-sm">
                    <bdi>{selected?.name ?? t(projectId ? 'nav.site' : 'project.allSites')}</bdi>
                  </span>
                  <span className="block truncate text-start text-muted-foreground text-xs">{t(projectId ? 'nav.site' : 'nav.workspace')}</span>
                </>
              )}
            </span>
            <ChevronsUpDown className="size-4.5 shrink-0 text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuLabel>{t('project.allSites')}</DropdownMenuLabel>
            <DropdownMenuItem ref={workspaceItem} onClick={() => go(() => void navigate({ to: '/app' }))}>
              <LayoutGrid className="size-4.5" />
              <span className="flex-1">{t('nav.workspace')}</span>
              {!projectId ? <Check className="size-4 text-primary" /> : null}
            </DropdownMenuItem>
            {isError ? (
              <div className="p-2" role="alert">
                <p className="text-destructive text-sm">{t('nav.sitesLoadError')}</p>
                <DropdownMenuItem
                  className="mt-2 justify-center"
                  closeOnClick={false}
                  disabled={isFetching}
                  nativeButton
                  onClick={(event) => {
                    event.preventBaseUIHandler();
                    workspaceItem.current?.focus();
                    void refetch();
                  }}
                  render={<Button loading={isFetching} size="sm" variant="outline" />}
                >
                  {t('error.tryAgain')}
                </DropdownMenuItem>
              </div>
            ) : null}
            {(projects ?? []).length > 0 ? <DropdownMenuSeparator /> : null}
            {(projects ?? []).map((site) => (
              <DropdownMenuItem
                key={site.id}
                onClick={() => go(() => void navigate({ to: '/app/projects/$projectId', params: { projectId: site.id } }))}
              >
                <NibleafMark className="size-4.5" />
                <span className="flex-1 truncate text-start">
                  <bdi>{site.name}</bdi>
                </span>
                {site.id === projectId ? <Check className="size-4 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => go(() => void navigate({ to: '/app/sites', search: { newSite: true } }))}>
              <Plus className="size-4.5" /> {t('dashboard.newProject')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
