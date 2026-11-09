import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@nibleaf/design-system/components/ui/breadcrumb';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useRouterState } from '@tanstack/react-router';
import type { CSSProperties, ReactNode } from 'react';
import { AppSidebar } from '@/components/app/app-sidebar';
import { NotificationsPopover } from '@/components/app/notifications-popover';
import { ShellSearchButton } from '@/components/app/shell-search-button';

/** Derive the header title key from the current dashboard route. */
function titleKeyFromPathname(pathname: string): MessageKey {
  if (pathname.startsWith('/app/people') || pathname.startsWith('/app/members')) return 'nav.people';
  if (pathname.startsWith('/app/settings')) {
    return 'dashboard.header.settings';
  }
  if (pathname.startsWith('/app/analytics')) return 'nav.analytics';
  if (pathname.startsWith('/app/sites')) return 'nav.sites';
  if (pathname === '/app' || pathname === '/app/') return 'nav.overview';
  return 'dashboard.header.projects';
}

/** The signed-in workspace shell: sidebar + top bar (the palette itself is app-wide). */
export function DashboardLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = t(titleKeyFromPathname(pathname));

  return (
    <SidebarProvider style={{ '--sidebar-width': '18rem', '--header-height': '3rem' } as CSSProperties}>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center min-w-0 gap-2 border-border border-b bg-background/80 px-3 sm:px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" label={t('nav.toggleSidebar')} />
          <Breadcrumb aria-label={t('nav.breadcrumb')} className="min-w-0 flex-1">
            <BreadcrumbList className="flex-nowrap">
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="truncate font-medium">{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <ShellSearchButton />
          <NotificationsPopover />
        </header>
        {/* SidebarInset is already the page's <main>; a nested one confuses screen readers. */}
        <div className="w-full flex-1 px-4 py-6 outline-none sm:px-6 sm:py-8" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
