import { createFileRoute, Navigate, Outlet, redirect } from '@tanstack/react-router';
import { CommandPaletteProvider } from '@/components/app/command-palette';
import { SwitcherProvider } from '@/components/app/org-switcher/switcher-provider';
import { SkipToContent } from '@/components/app/skip-to-content';
import { SupportAccessBanner } from '@/components/app/support-access-banner';
import { AppProviders } from '@/components/app-providers';
import { PageLoader } from '@/components/page-loader';
import { getSessionFn } from '@/functions/session';
import { switcherQueryOptions } from '@/hooks/api/organization-query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { syncDashboardSession } from '@/integrations/tanstack-query/session-cache';
import { useDashboardIntentPreload } from '@/lib/dashboard-intent-preload';
import { useSession } from '@/services/auth-client';
import { useDashboardSessionBoundary } from '@/services/dashboard-session';
import { ProjectProvider } from '@/stores/active-project';

export const Route = createFileRoute('/app')({
  beforeLoad: async ({ context: { queryClient }, location }) => {
    const routeSession = await getSessionFn();
    if (typeof window !== 'undefined') {
      syncDashboardSession(queryClient, routeSession?.user.id ?? null);
    }
    if (!routeSession) {
      // Keep the page they asked for (a shared conversation, a settings section…)
      // so signing in brings them back to it instead of the overview. Imported
      // lazily: beforeLoad is in the router's eager chunk, which docs pages load.
      const { signInReturnSearch } = await import('@/lib/invitations');
      throw redirect({ to: '/sign-in', search: signInReturnSearch(location.href) });
    }
    // UI-only: invitations, join links, sign-out and machine APIs live outside
    // /app. Let admission finish before asking for a dashboard display name.
    if (!routeSession.user.name?.trim()) {
      const { nameReturnPath } = await import('@/lib/name-onboarding');
      throw redirect({ to: '/welcome/name', search: { redirect: nameReturnPath(location.href) } });
    }
    return { routeSession };
  },
  // Organizations feed every signed-in screen (switcher, palette, landing), so
  // start them with the session check instead of after the shell mounts.
  // The bell's unread count too, so its badge is there on first paint (audit WORKSPACE-28).
  // Lazily, from its own small module: this file is in the router's eager chunk,
  // which public docs pages load, so nothing here may add to their first load.
  loader: async ({ context: { queryClient } }) => {
    prefetchRouteData(queryClient, switcherQueryOptions());
    const { unreadNotificationCountQueryOptions } = await import('@/hooks/api/notification-query-options');
    prefetchRouteData(queryClient, unreadNotificationCountQueryOptions());
  },
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
  // Dashboard links preload their route's chunks on hover and focus.
  useDashboardIntentPreload();

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
    <div className={impersonatedBy ? 'pb-14' : undefined} data-dashboard-shell="">
      <SkipToContent />
      <ProjectProvider key={resolvedSession.user.id}>
        {/* One switcher and one palette for every signed-in screen (org pages, site pages, editor). */}
        <SwitcherProvider>
          <CommandPaletteProvider>
            <Outlet />
          </CommandPaletteProvider>
        </SwitcherProvider>
      </ProjectProvider>
      {impersonatedBy && supportSession.user?.id ? (
        <SupportAccessBanner customerId={supportSession.user.id} customerName={supportSession.user.name || supportSession.user.email} />
      ) : null}
    </div>
  );
}
