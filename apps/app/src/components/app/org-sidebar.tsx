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
import { BarChart3, BookOpen, type LucideIcon, ReceiptText, Settings, Users } from 'lucide-react';
import { SidebarAccountFooter } from '@/components/app/sidebar-account-footer';
import { SidebarBrand } from '@/components/app/sidebar-brand';

export type OrgSection = 'websites' | 'analytics' | 'members' | 'billing' | 'settings';

/** Organization navigation (§5.1). Members and Usage & billing are for Owner/Admin. */
export const ORG_NAV: ReadonlyArray<{ section: OrgSection; labelKey: MessageKey; icon: LucideIcon; adminOnly: boolean }> = [
  { section: 'websites', labelKey: 'nav.websites', icon: BookOpen, adminOnly: false },
  { section: 'analytics', labelKey: 'nav.analytics', icon: BarChart3, adminOnly: false },
  { section: 'members', labelKey: 'nav.members', icon: Users, adminOnly: true },
  { section: 'billing', labelKey: 'nav.billing', icon: ReceiptText, adminOnly: true },
  { section: 'settings', labelKey: 'nav.settings', icon: Settings, adminOnly: false },
];

export function OrgSidebar({ orgSlug, isAdmin }: { orgSlug: string; isAdmin: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useLocale();
  const direction = useDirection();
  const { setOpenMobile } = useSidebar();
  const base = `/app/o/${orgSlug}`;

  return (
    <Sidebar
      mobileDescription={t('nav.organizationSidebarDescription')}
      mobileTitle={t('nav.sidebarTitle')}
      side={direction === 'rtl' ? 'right' : 'left'}
      variant="inset"
    >
      <SidebarHeader>
        <SidebarBrand orgSlug={orgSlug} />
      </SidebarHeader>
      <SidebarContent>
        {/* The sidebar's links are the site's main navigation landmark. */}
        <nav aria-label={t('nav.main')} className="contents">
          <SidebarGroup>
            <SidebarMenu>
              {ORG_NAV.filter((item) => isAdmin || !item.adminOnly).map((item) => {
                const label = t(item.labelKey);
                return (
                  <SidebarMenuItem key={item.section}>
                    <SidebarMenuButton
                      isActive={pathname.startsWith(`${base}/${item.section}`)}
                      onClick={() => setOpenMobile(false)}
                      render={<Link params={{ orgSlug }} to={`/app/o/$orgSlug/${item.section}`} />}
                      size="lg"
                      tooltip={label}
                    >
                      <item.icon className="size-5" />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </nav>
      </SidebarContent>
      <SidebarAccountFooter />
    </Sidebar>
  );
}
