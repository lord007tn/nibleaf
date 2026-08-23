import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@nibleaf/design-system/components/ui/breadcrumb';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { AppSidebar } from '@/components/app/app-sidebar';
import { CommandPalette } from '@/components/app/command-palette';
import { NotificationsPopover } from '@/components/app/notifications-popover';

/** Derive the header title key from the current dashboard route. */
function titleKeyFromPathname(pathname: string): MessageKey {
  if (pathname.startsWith('/app/members')) {
    return 'dashboard.header.members';
  }
  if (pathname.startsWith('/app/settings')) {
    return 'dashboard.header.settings';
  }
  if (pathname.startsWith('/app/analytics')) return 'nav.analytics';
  if (pathname.startsWith('/app/sites')) return 'nav.sites';
  if (pathname === '/app' || pathname === '/app/') return 'nav.overview';
  return 'dashboard.header.projects';
}

/** The signed-in workspace shell: sidebar + top bar + command palette. */
export function DashboardLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = t(titleKeyFromPathname(pathname));
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <SidebarProvider style={{ '--sidebar-width': '18rem', '--header-height': '3rem' } as CSSProperties}>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-border border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <button
            className="ms-auto flex h-8 w-56 items-center gap-2 rounded-lg border border-input bg-transparent px-3 text-muted-foreground text-sm shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            onClick={() => setPaletteOpen(true)}
            type="button"
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-start">{t('dashboard.search.placeholder')}</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd>
          </button>
          <NotificationsPopover />
        </header>
        <main className="w-full flex-1 px-6 py-8">{children}</main>
      </SidebarInset>
      <CommandPalette onOpenChange={setPaletteOpen} open={paletteOpen} />
    </SidebarProvider>
  );
}
