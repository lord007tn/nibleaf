import { Button } from '@nibleaf/design-system/components/ui/button';
import { Separator } from '@nibleaf/design-system/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@nibleaf/design-system/components/ui/sidebar';
import { createFileRoute, Navigate, Outlet, redirect, useRouterState } from '@tanstack/react-router';
import { AlertCircle, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { AdminSidebar } from '@/components/admin-sidebar';
import { PageLoader } from '@/components/page-loader';
import { ThemeToggle } from '@/components/theme-toggle';
import { getSessionFn } from '@/functions/session';
import { AdminApiError, useAdminOverview } from '@/hooks/api/queries';
import { signOut, useSession } from '@/services/auth-client';

export const Route = createFileRoute('/(dashboard)')({
  beforeLoad: async () => {
    const routeSession = await getSessionFn();
    if (!routeSession) {
      throw redirect({ to: '/sign-in' });
    }
    return { routeSession };
  },
  component: DashboardRoute,
});

function FullScreen({ children }: { children: ReactNode }) {
  return <div className="grid min-h-screen place-items-center bg-background px-6 text-muted-foreground text-sm">{children}</div>;
}

function DashboardRoute() {
  const { routeSession } = Route.useRouteContext();
  const { data: session, isPending } = useSession();
  const resolvedSession = session ?? (isPending ? routeSession : null);

  if (isPending && !resolvedSession) {
    return <PageLoader />;
  }
  if (!resolvedSession) return <Navigate to="/sign-in" />;
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
    const unauthorized = overview.error instanceof AdminApiError && [401, 403].includes(overview.error.status);
    return (
      <FullScreen>
        <div className="flex flex-col items-center gap-3 text-center">
          {unauthorized ? <ShieldCheck className="size-8 text-muted-foreground" /> : <AlertCircle className="size-8 text-destructive" />}
          <h1 className="font-semibold text-foreground text-xl tracking-tight">{unauthorized ? 'Not authorized' : 'Admin data unavailable'}</h1>
          <p className="max-w-sm text-muted-foreground text-sm">
            {unauthorized
              ? "Your account doesn't have admin access to this panel."
              : 'Your session is valid, but the admin API could not be reached. No authorization conclusion was inferred from this failure.'}
          </p>
          {unauthorized ? (
            <Button className="mt-1" onClick={() => void signOut().then(() => window.location.assign('/sign-in'))} variant="outline">
              Sign out
            </Button>
          ) : (
            <Button className="mt-1" onClick={() => void overview.refetch()} variant="outline">
              Try again
            </Button>
          )}
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
  if (pathname.startsWith('/operations')) {
    return 'Operations';
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
        <main className="w-full flex-1 px-4 py-6 md:px-6">
          <Outlet />
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
