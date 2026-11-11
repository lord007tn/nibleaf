import { useDirection } from '@nibleaf/design-system/components/ui/direction';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@nibleaf/design-system/components/ui/sidebar';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { Link, useRouterState } from '@tanstack/react-router';
import { BarChart3, Bot, History, LayoutDashboard, type LucideIcon, PenLine, Settings as SettingsIcon } from 'lucide-react';
import { SidebarAccountFooter } from '@/components/app/sidebar-account-footer';
import { SidebarBrand } from '@/components/app/sidebar-brand';

type NavItem = { labelKey: MessageKey; to: string; icon: LucideIcon; isActive: boolean };

/** Per-site sidebar: brand, the site's sections, and the account footer. The switcher lives in the header. */
export function ProjectSidebar({ projectId, orgSlug }: { projectId: string; orgSlug?: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLocale();
  const direction = useDirection();
  const { setOpenMobile } = useSidebar();

  const base = `/app/projects/${projectId}`;
  const nav: NavItem[] = [
    { labelKey: 'project.overview', to: '/app/projects/$projectId', icon: LayoutDashboard, isActive: pathname === base },
    { labelKey: 'project.editor', to: '/app/projects/$projectId/editor', icon: PenLine, isActive: pathname.startsWith(`${base}/editor`) },
    { labelKey: 'publishes.title', to: '/app/projects/$projectId/publishes', icon: History, isActive: pathname.startsWith(`${base}/publishes`) },
    { labelKey: 'project.analytics', to: '/app/projects/$projectId/analytics', icon: BarChart3, isActive: pathname.startsWith(`${base}/analytics`) },
    { labelKey: 'dashboard.ai.title', to: '/app/projects/$projectId/ai', icon: Bot, isActive: pathname.startsWith(`${base}/ai`) },
    { labelKey: 'project.settings', to: '/app/projects/$projectId/settings', icon: SettingsIcon, isActive: pathname.startsWith(`${base}/settings`) },
  ];

  return (
    <Sidebar
      mobileTitle={t('nav.sidebarTitle')}
      mobileDescription={t('nav.sidebarDescription')}
      side={direction === 'rtl' ? 'right' : 'left'}
      variant="inset"
    >
      <SidebarHeader>
        <SidebarBrand orgSlug={orgSlug} />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {nav.map((item) => (
              <SidebarMenuItem key={item.labelKey}>
                <SidebarMenuButton
                  onClick={() => setOpenMobile(false)}
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
