import { createFileRoute, Outlet } from '@tanstack/react-router';
import { DashboardLayout } from '@/layouts/dashboard';

export const Route = createFileRoute('/app/(dashboard)')({
  component: DashboardRoute,
});

/** Pathless layout: provides the dashboard chrome (sidebar + topbar + palette). */
function DashboardRoute() {
  return (
    <DashboardLayout>
      <Outlet />
    </DashboardLayout>
  );
}

