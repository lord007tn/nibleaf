import { Button } from '@nibleaf/design-system/components/ui/button';
import { Separator } from '@nibleaf/design-system/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { ShieldCheck } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { AdminSidebar } from '@/components/admin-sidebar';
import { PageLoader } from '@/components/page-loader';
import { ThemeToggle } from '@/components/theme-toggle';
import { useAdminOverview } from '@/hooks/api/queries';
import { signOut, useSession } from '@/lib/auth-client';

export const Route = createFileRoute('/(dashboard)')({
  component: DashboardRoute,
});

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-background px-6 text-muted-foreground text-sm">{children}</div>;
}

function DashboardRoute() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();
  useEffect(() => {
    if (!isPending && !session) {
      navigate({ to: '/sign-in' });
    }
  }, [isPending, session, navigate]);

  if (isPending || !session) {
    return <PageLoader />;
  }
  return <AdminGate />;
}

/** Admin-role gate: the overview endpoint 403s for non-admins, so if it fails we
 *  render "not authorized" instead of the panel (server-enforced regardless). */
function AdminGate() {
  const overview = useAdminOverview();
  if (overview.isPending) {
    return <PageLoader />;
  }
  if (overview.isError) {
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-3 text-center">
          <ShieldCheck className="size-8 text-muted-foreground" />
          <h1 className="font-semibold text-foreground text-xl tracking-tight">Not authorized</h1>
          <p className="max-w-sm text-muted-foreground text-sm">Your account doesn't have admin access to this panel.</p>
          <Button className="mt-1" onClick={() => void signOut().then(() => window.location.assign('/sign-in'))} variant="outline">
            Sign out
          </Button>
        </div>
      </FullScreen>
    );
  }
  return <AdminShell />;
}

/** Derive the header title from the current admin route. */
function titleFromPathname(pathname: string): string {
  if (pathname.startsWith('/users')) {
    return 'Customers';
  }
  if (pathname.startsWith('/sites')) {
    return 'Sites';
  }
  return 'Overview';
}

function AdminShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const title = titleFromPathname(pathname);

  return (
    <SidebarProvider>
      <AdminSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-border border-b bg-background/80 px-4 backdrop-blur">
          <SidebarTrigger className="-ms-1" />
          <Separator className="me-1 data-[orientation=vertical]:h-4" orientation="vertical" />
          <span className="font-medium text-sm">{title}</span>
          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
