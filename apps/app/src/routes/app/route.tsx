import { createFileRoute, Navigate, Outlet, redirect } from '@tanstack/react-router';
import { AppProviders } from '@/components/app-providers';
import { PageLoader } from '@/components/page-loader';
import { QueryProvider } from '@/integrations/tanstack-query/root-provider';
import { useSession } from '@/lib/auth-client';
import { getRouteSession, resolveRouteSession, shouldShowInitialSessionLoader } from '@/lib/route-session';
import { ProjectProvider } from '@/stores/active-project';

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const routeSession = await getRouteSession();
    if (!routeSession) {
      throw redirect({ to: '/sign-in' });
    }
    return { routeSession };
  },
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex' }],
  }),
  component: AppRoute,
});

/** Forward guard: signed-out users go to sign-in; the rest get the app. */
function AppRoute() {
  return (
    <QueryProvider>
      <AppProviders>
        <AppGuard />
      </AppProviders>
    </QueryProvider>
  );
}

function AppGuard() {
  const { routeSession } = Route.useRouteContext();
  const { data: session, isPending } = useSession();
  const resolvedSession = resolveRouteSession(session, routeSession, isPending);

  if (shouldShowInitialSessionLoader(isPending, resolvedSession)) {
    return <PageLoader />;
  }
  if (!resolvedSession) return <Navigate to="/sign-in" />;
  return (
    <ProjectProvider>
      <Outlet />
    </ProjectProvider>
  );
}
