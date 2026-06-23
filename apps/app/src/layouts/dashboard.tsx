import { useRouterState } from '@tanstack/react-router';
import { Search } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { AppSidebar } from '@/components/app/app-sidebar';
import { CommandPalette } from '@/components/app/command-palette';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

/** Derive the header title key from the current dashboard route. */
function titleKeyFromPathname(pathname: string): MessageKey {
  if (pathname.startsWith('/app/members')) {
    return 'dashboard.header.members';
  }
  if (pathname.startsWith('/app/settings')) {
    return 'dashboard.header.settings';
  }
  return 'dashboard.header.projects';
}

/** The signed-in workspace shell: sidebar + top bar + command palette. */
export function DashboardLayout({ children }: { children: ReactNode }) {
  const t = useT();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = t(titleKeyFromPathname(pathname));
  const [paletteOpen, setPaletteOpen] = useState(false);

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-border border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" />
          <Separator className="me-1 data-[orientation=vertical]:h-4" orientation="vertical" />
          <span className="font-medium text-sm">{title}</span>
          <button
            className="ms-auto flex h-8 w-56 items-center gap-2 rounded-lg border border-border bg-card px-3 text-muted-foreground text-sm"
            onClick={() => setPaletteOpen(true)}
            type="button"
          >
            <Search className="size-3.5" />
            <span className="flex-1 text-start">{t('dashboard.search.placeholder')}</span>
            <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd>
          </button>
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-6 py-8">{children}</main>
      </SidebarInset>
      <CommandPalette onOpenChange={setPaletteOpen} open={paletteOpen} />
    </SidebarProvider>
  );
}
