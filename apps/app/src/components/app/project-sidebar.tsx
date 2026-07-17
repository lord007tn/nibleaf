import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@nibleaf/design-system/components/ui/sidebar';
import { Link, useRouterState } from '@tanstack/react-router';
import { BarChart3, LayoutDashboard, type LucideIcon, PenLine, Settings as SettingsIcon } from 'lucide-react';
import { SidebarAccountFooter } from '@/components/app/sidebar-account-footer';
import { SiteSwitcher } from '@/components/app/site-switcher';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

type NavItem = { labelKey: MessageKey; to: string; icon: LucideIcon; isActive: boolean };

/** Per-site sidebar: site switcher, the site's sections, and the account footer. */
export function ProjectSidebar({ projectId }: { projectId: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const t = useT();

  const base = `/app/projects/${projectId}`;
  const nav: NavItem[] = [
    { labelKey: 'project.overview', to: '/app/projects/$projectId', icon: LayoutDashboard, isActive: pathname === base },
    { labelKey: 'project.editor', to: '/app/projects/$projectId/editor', icon: PenLine, isActive: pathname.startsWith(`${base}/editor`) },
    { labelKey: 'project.analytics', to: '/app/projects/$projectId/analytics', icon: BarChart3, isActive: pathname.startsWith(`${base}/analytics`) },
    { labelKey: 'project.settings', to: '/app/projects/$projectId/settings', icon: SettingsIcon, isActive: pathname.startsWith(`${base}/settings`) },
  ];

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SiteSwitcher projectId={projectId} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {nav.map((item) => (
              <SidebarMenuItem key={item.labelKey}>
                <SidebarMenuButton
                  isActive={item.isActive}
                  render={<Link params={{ projectId }} to={item.to} />}
                  size="lg"
                  tooltip={t(item.labelKey)}
                >
                  <item.icon className="size-5" />
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
