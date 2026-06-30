import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth-client';
import { ProjectProvider } from '@/stores/active-project';

export const Route = createFileRoute('/app')({
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex' }],
  }),
  component: AppRoute,
});

/** Forward guard: signed-out users go to sign-in; the rest get the app. */
function AppRoute() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!(isPending || session)) {
      navigate({ to: '/sign-in' });
    }
  }, [isPending, session, navigate]);

  if (isPending || !session) {
    return <div className="grid min-h-screen place-items-center bg-background text-muted-foreground text-sm">Loading…</div>;
  }
  return (
    <ProjectProvider>
      <Outlet />
    </ProjectProvider>
  );
}

