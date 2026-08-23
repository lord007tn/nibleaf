import { NibleafMark } from '@nibleaf/design-system/brand';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { Check, ChevronsUpDown, LayoutGrid, Plus } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useProjects } from '@/hooks/api';

const subscribeToHydration = () => () => undefined;

export function SiteSwitcher({ projectId }: { projectId?: string }) {
  const { data: projects } = useProjects();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const selected = hydrated ? projects?.find((project) => project.id === projectId) : undefined;
  const navigate = useNavigate();
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            className="flex h-12 w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg p-2 text-start hover:bg-sidebar-accent"
            type="button"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-primary/10">
              {selected ? <NibleafMark className="size-5.5" /> : <LayoutGrid className="size-4.5 text-sidebar-primary" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold text-sm">{selected?.name ?? t('project.allSites')}</span>
              <span className="block truncate text-muted-foreground text-xs">{selected ? t('nav.site') : t('nav.workspace')}</span>
            </span>
            <ChevronsUpDown className="size-4.5 shrink-0 text-muted-foreground" />
          </button>
        }
      />
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t('project.allSites')}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => navigate({ to: '/app' })}>
          <LayoutGrid className="size-4.5" />
          <span className="flex-1">{t('nav.workspace')}</span>
          {!projectId ? <Check className="size-4 text-primary" /> : null}
        </DropdownMenuItem>
        {(projects ?? []).length > 0 ? <DropdownMenuSeparator /> : null}
        {(projects ?? []).map((site) => (
          <DropdownMenuItem key={site.id} onClick={() => navigate({ to: '/app/projects/$projectId', params: { projectId: site.id } })}>
            <NibleafMark className="size-4.5" />
            <span className="flex-1 truncate">{site.name}</span>
            {site.id === projectId ? <Check className="size-4 text-primary" /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate({ to: '/app/sites', search: { newSite: true } })}>
          <Plus className="size-4.5" /> {t('dashboard.newProject')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
