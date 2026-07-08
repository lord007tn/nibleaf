import { NibleafMark, NibleafWordmark } from '@nibleaf/design-system/brand';
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
import { BarChart3, BookText, Settings } from 'lucide-react';
import { SidebarAccountFooter } from '@/components/app/sidebar-account-footer';
import { useLocale } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

// Account-level nav. Members live per-site now (each site's Settings → Members),
// so they're not here; Analytics stays as the cross-site global view.
const NAV = [
  { to: '/app', labelKey: 'nav.sites', icon: BookText, exact: true },
  { to: '/app/analytics', labelKey: 'nav.analytics', icon: BarChart3, exact: false },
  { to: '/app/settings', labelKey: 'nav.settings', icon: Settings, exact: false },
] as const satisfies ReadonlyArray<{ to: string; labelKey: MessageKey; icon: typeof BookText; exact: boolean }>;

export function AppSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLocale();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <NibleafMark className="size-7" />
          <NibleafWordmark className="font-semibold tracking-tight" />
          <span className="ms-auto rounded-md bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{t('brand.oss')}</span>
        </div>
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
                  <SidebarMenuButton isActive={active} render={<Link to={item.to} />} tooltip={label}>
                    <item.icon className="size-4" />
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
