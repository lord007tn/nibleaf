import { createFileRoute, Navigate, Outlet, redirect } from '@tanstack/react-router';
import { CommandPaletteProvider } from '@/components/app/command-palette';
import { SkipToContent } from '@/components/app/skip-to-content';
import { SupportAccessBanner } from '@/components/app/support-access-banner';
import { AppProviders } from '@/components/app-providers';
import { PageLoader } from '@/components/page-loader';
import { getSessionFn } from '@/functions/session';
import { projectsQueryOptions } from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { syncDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { useSession } from '@/services/auth-client';
import { useDashboardSessionBoundary } from '@/services/dashboard-session';
import { ProjectProvider } from '@/stores/active-project';

export const Route = createFileRoute('/app')({
  beforeLoad: async ({ context: { queryClient } }) => {
    const routeSession = await getSessionFn();
    if (typeof window !== 'undefined') {
      syncDashboardSession(queryClient, routeSession?.user.id ?? null);
    }
    if (!routeSession) {
      throw redirect({ to: '/sign-in' });
    }
    return { routeSession };
  },
  // The site list feeds every signed-in screen (site switcher, command palette,
  // overview), so start it with the session check instead of after the shell mounts.
  loader: ({ context: { queryClient } }) => prefetchRouteData(queryClient, projectsQueryOptions()),
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex' }],
  }),
  component: AppRoute,
});

/** Forward guard: signed-out users go to sign-in; the rest get the app. */
function AppRoute() {
  return (
    <AppProviders>
      <AppGuard />
    </AppProviders>
  );
}

function AppGuard() {
  const { routeSession } = Route.useRouteContext();
  const { data: session, isPending } = useSession();
  const resolvedSession = session ?? (isPending ? routeSession : null);
  const sessionReady = useDashboardSessionBoundary(resolvedSession?.user.id ?? null);

  if (!sessionReady || (isPending && !resolvedSession)) {
    return <PageLoader />;
  }
  if (!resolvedSession) return <Navigate to="/sign-in" />;
  const supportSession = resolvedSession as {
    session?: { impersonatedBy?: string | null };
    user?: { id?: string | null; name?: string | null; email?: string | null };
  };
  const impersonatedBy = supportSession.session?.impersonatedBy;
  return (
    <div className={impersonatedBy ? 'pb-14' : undefined}>
      <SkipToContent />
      <ProjectProvider key={resolvedSession.user.id}>
        {/* One palette for every signed-in screen (dashboard, site pages, editor). */}
        <CommandPaletteProvider>
          <Outlet />
        </CommandPaletteProvider>
      </ProjectProvider>
      {impersonatedBy && supportSession.user?.id ? (
        <SupportAccessBanner customerId={supportSession.user.id} customerName={supportSession.user.name || supportSession.user.email} />
      ) : null}
    </div>
  );
}
