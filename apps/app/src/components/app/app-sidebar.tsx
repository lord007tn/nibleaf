import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@nibleaf/design-system/components/ui/sidebar';
import { Link, useRouterState } from '@tanstack/react-router';
import { BarChart3, BookOpen, LayoutDashboard, Settings } from 'lucide-react';
import { SidebarAccountFooter } from '@/components/app/sidebar-account-footer';
import { SiteSwitcher } from '@/components/app/site-switcher';
import { useLocale } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

// Account-level nav. Members live per-site now (each site's Settings → Members),
// so they're not here; Analytics stays as the cross-site global view.
const NAV = [
  { to: '/app', labelKey: 'nav.overview', icon: LayoutDashboard, exact: true },
  { to: '/app/sites', labelKey: 'nav.sites', icon: BookOpen, exact: false },
  { to: '/app/analytics', labelKey: 'nav.analytics', icon: BarChart3, exact: false },
  { to: '/app/settings', labelKey: 'nav.settings', icon: Settings, exact: false },
] as const satisfies ReadonlyArray<{ to: string; labelKey: MessageKey; icon: typeof BookOpen; exact: boolean }>;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLocale();

  return (
    <Sidebar variant="inset">
      <SidebarHeader>
        <SiteSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.account')}</SidebarGroupLabel>
          <SidebarMenu>
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
              const label = t(item.labelKey);
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton isActive={active} render={<Link to={item.to} />} size="lg" tooltip={label}>
                    <item.icon className="size-5" />
                    <span>{label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarAccountFooter />
    </Sidebar>
  );
}
