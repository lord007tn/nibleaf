import { useT } from '@nibleaf/i18n/react';
import { createFileRoute, Navigate, Outlet, redirect } from '@tanstack/react-router';
import { CommandPaletteProvider } from '@/components/app/command-palette';
import { SupportAccessBanner } from '@/components/app/support-access-banner';
import { AppProviders } from '@/components/app-providers';
import { PageLoader } from '@/components/page-loader';
import { getSessionFn } from '@/functions/session';
import { QueryProvider } from '@/integrations/tanstack-query/root-provider';
import { useSession } from '@/services/auth-client';
import { ProjectProvider } from '@/stores/active-project';

export const Route = createFileRoute('/app')({
  beforeLoad: async () => {
    const routeSession = await getSessionFn();
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
  const resolvedSession = session ?? (isPending ? routeSession : null);

  if (isPending && !resolvedSession) {
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
      <ProjectProvider>
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

/** Keyboard users jump past the sidebar. Targets the dashboard content, else the
 *  layout's <main> (the site/editor shell has no #main-content of its own). */
function SkipToContent() {
  const t = useT();
  const skip = () => {
    const target = document.getElementById('main-content') ?? document.querySelector<HTMLElement>('main');
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  };
  return (
    <button
      className="sr-only rounded-md bg-background px-3 py-2 font-medium text-sm shadow-md outline-none ring-3 ring-ring/50 focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[100]"
      onClick={skip}
      type="button"
    >
      {t('nav.skipToContent')}
    </button>
  );
}
