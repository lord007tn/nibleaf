import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from '@nibleaf/design-system/components/ui/breadcrumb';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { AppSidebar } from '@/components/app/app-sidebar';
import { useOpenCommandPalette } from '@/components/app/command-palette';
import { NotificationsPopover } from '@/components/app/notifications-popover';
import { useSearchShortcutLabel } from '@/lib/shortcut';

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
  const openPalette = useOpenCommandPalette();
  const searchShortcut = useSearchShortcutLabel();

  return (
    <SidebarProvider style={{ '--sidebar-width': '18rem', '--header-height': '3rem' } as CSSProperties}>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-border border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" label={t('nav.toggleSidebar')} />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbPage>{title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {/* Icon-only on phones; the keyboard hint only where a keyboard is likely. */}
          <button
            aria-label={t('command.dialog.title')}
            className="ms-auto flex h-8 items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-muted-foreground text-sm shadow-xs outline-none transition-colors hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-56 sm:px-3 dark:bg-input/30 pointer-coarse:h-10 pointer-coarse:min-w-10"
            onClick={() => openPalette?.()}
            type="button"
          >
            <Search aria-hidden className="size-3.5" />
            <span aria-hidden className="hidden flex-1 text-start sm:inline">
              {t('dashboard.search.placeholder')}
            </span>
            <kbd
              aria-hidden
              className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] md:inline pointer-coarse:hidden"
              dir="ltr"
            >
              {searchShortcut}
            </kbd>
          </button>
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
