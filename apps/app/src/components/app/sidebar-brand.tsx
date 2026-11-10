import { NibleafMark } from '@nibleaf/design-system/brand';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@nibleaf/design-system/components/ui/sidebar';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';

/**
 * Sidebar header: the product mark, linking to the organization's Websites.
 * Changing organization or website happens only in the header switcher
 * (§5.4.1), so the sidebar no longer has a switcher of its own.
 */
export function SidebarBrand({ orgSlug }: { orgSlug?: string }) {
  const t = useT();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => setOpenMobile(false)}
          render={orgSlug ? <Link params={{ orgSlug }} to="/app/o/$orgSlug/websites" /> : <Link to="/app" />}
          size="lg"
          tooltip={t('nav.websites')}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar-primary/10">
            <NibleafMark className="size-5.5" />
          </span>
          <span className="font-semibold text-sm">Nibleaf</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
