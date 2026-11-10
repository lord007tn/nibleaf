import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@nibleaf/design-system/components/ui/breadcrumb';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import { useT } from '@nibleaf/i18n/react';
import { useRouterState } from '@tanstack/react-router';
import type { CSSProperties, ReactNode } from 'react';
import { NotificationsPopover } from '@/components/app/notifications-popover';
import { ORG_NAV, OrgSidebar } from '@/components/app/org-sidebar';
import { OrganizationSwitcher } from '@/components/app/org-switcher/organization-switcher';
import { ShellSearchButton } from '@/components/app/shell-search-button';
import type { OrganizationDetail } from '@/hooks/api/organization-query-options';

/** Organization shell (§5.1): org sidebar, and a header that starts with `[Org ▾]` then the page title. */
export function OrganizationLayout({
  orgSlug,
  organization,
  children,
}: {
  orgSlug: string;
  organization: OrganizationDetail | undefined;
  children: ReactNode;
}) {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const section = ORG_NAV.find((item) => pathname.startsWith(`/app/o/${orgSlug}/${item.section}`));
  const isAdmin = organization ? organization.orgRole !== 'member' : false;

  return (
    <SidebarProvider style={{ '--sidebar-width': '18rem', '--header-height': '3rem' } as CSSProperties}>
      <OrgSidebar isAdmin={isAdmin} orgSlug={organization?.slug ?? orgSlug} />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center min-w-0 gap-2 border-border border-b bg-background/80 px-3 sm:px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" label={t('nav.toggleSidebar')} />
          <Breadcrumb aria-label={t('nav.breadcrumb')} className="min-w-0 flex-1">
            <BreadcrumbList className="flex-nowrap gap-1 sm:gap-1">
              <BreadcrumbItem className="min-w-0 shrink">
                <OrganizationSwitcher organization={organization} />
              </BreadcrumbItem>
              {section ? (
                <>
                  <BreadcrumbSeparator className="shrink-0" />
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbPage className="truncate font-medium">{t(section.labelKey)}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              ) : null}
            </BreadcrumbList>
          </Breadcrumb>
          <ShellSearchButton />
          <NotificationsPopover />
        </header>
        <div className="w-full flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
