import { Button } from '@nibleaf/design-system/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@nibleaf/design-system/components/ui/sheet';
import { createFileRoute, Link, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { LayoutDashboard, LogOut, Menu, Server, ShieldCheck, Users } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { useEffect, useState } from 'react';
import { PageLoader } from '@/components/page-loader';
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

const NAV: { to: string; label: string; icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/users', label: 'Customers', icon: Users },
  { to: '/sites', label: 'Sites', icon: Server },
];

/** Nav links + Sign out, shared by the desktop aside and the mobile drawer. */
function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <div className="flex items-center gap-2 px-2 py-3">
        <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
          <ShieldCheck className="size-4" />
        </span>
        <span className="font-semibold tracking-tight">Nibleaf Admin</span>
      </div>
      <nav className="mt-2 flex flex-1 flex-col gap-0.5">
        {NAV.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            activeOptions={{ exact: item.to === '/' }}
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
            activeProps={{ className: 'bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary' }}
            onClick={onNavigate}
          >
            <item.icon className="size-4" /> {item.label}
          </Link>
        ))}
      </nav>
      <Button className="mt-2 justify-start gap-2.5" onClick={() => void signOut().then(() => window.location.assign('/sign-in'))} variant="ghost">
        <LogOut className="size-4" /> Sign out
      </Button>
    </>
  );
}

function AdminShell() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  // Close the drawer when the route changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on pathname change.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  return (
    <div className="grid min-h-screen grid-cols-1 bg-background md:grid-cols-[240px_1fr]">
      <aside className="hidden flex-col border-border border-e bg-sidebar/40 p-3 md:flex">
        <SidebarNav />
      </aside>
      <div className="flex min-h-0 flex-col">
        <header className="flex items-center gap-2 border-border border-b bg-sidebar/40 px-4 py-3 md:hidden">
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger
              aria-label="Open navigation"
              className="-ms-1 inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-3">
              <SheetHeader className="sr-only">
                <SheetTitle>Nibleaf Admin</SheetTitle>
              </SheetHeader>
              <div className="flex h-full flex-col">
                <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck className="size-3.5" />
            </span>
            <span className="font-semibold text-sm tracking-tight">Nibleaf Admin</span>
          </div>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
