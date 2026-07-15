import { NibleafMark } from '@nibleaf/design-system/brand';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@nibleaf/design-system/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@nibleaf/design-system/components/ui/sidebar';
import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { BarChart3, Boxes, Check, ChevronsUpDown, LayoutDashboard, type LucideIcon, PenLine, Plus, Settings as SettingsIcon } from 'lucide-react';
import { SidebarAccountFooter } from '@/components/app/sidebar-account-footer';
import { useProject, useProjects } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

type NavItem = { labelKey: MessageKey; to: string; icon: LucideIcon; isActive: boolean };

/** Per-site sidebar: site switcher, the site's sections, and the account footer. */
export function ProjectSidebar({ projectId }: { projectId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: project } = useProject(projectId);
  const { data: projects } = useProjects();
  const navigate = useNavigate();
  const t = useT();

  const base = `/app/projects/${projectId}`;
  const nav: NavItem[] = [
    { labelKey: 'project.overview', to: '/app/projects/$projectId', icon: LayoutDashboard, isActive: pathname === base },
    { labelKey: 'project.editor', to: '/app/projects/$projectId/editor', icon: PenLine, isActive: pathname.startsWith(`${base}/editor`) },
    { labelKey: 'project.analytics', to: '/app/projects/$projectId/analytics', icon: BarChart3, isActive: pathname.startsWith(`${base}/analytics`) },
    { labelKey: 'project.settings', to: '/app/projects/$projectId/settings', icon: SettingsIcon, isActive: pathname.startsWith(`${base}/settings`) },
  ];

  return (
    <Sidebar>
      <SidebarHeader>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className="flex w-full cursor-pointer items-center gap-2 overflow-hidden rounded-md p-2 text-start transition-colors hover:bg-sidebar-accent"
                type="button"
              >
                <NibleafMark className="size-7 shrink-0" />
                <span className="flex-1 truncate font-semibold tracking-tight">{project?.name ?? 'Nibleaf'}</span>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
              </button>
            }
          />
          <DropdownMenuContent align="start" className="w-56">
            {(projects ?? []).map((site) => (
              <DropdownMenuItem key={site.id} onClick={() => navigate({ to: '/app/projects/$projectId', params: { projectId: site.id } })}>
                <span className="flex-1 truncate">{site.name}</span>
                {site.id === projectId ? <Check className="size-3.5 text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({ to: '/app', search: { newSite: true } })}>
              <Plus className="size-3.5" /> {t('dashboard.newProject')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate({ to: '/app' })}>
              <Boxes className="size-3.5" /> {t('project.allSites')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {nav.map((item) => (
              <SidebarMenuItem key={item.labelKey}>
                <SidebarMenuButton isActive={item.isActive} render={<Link params={{ projectId }} to={item.to} />} tooltip={t(item.labelKey)}>
                  <item.icon className="size-4" />
                  <span>{t(item.labelKey)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarAccountFooter />
    </Sidebar>
  );
}
