import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { PageLoader } from '@/components/page-loader';
import { useSession } from '@/lib/auth-client';

export const Route = createFileRoute('/(auth)')({
  component: AuthRoute,
});

/** Reverse guard: a signed-in user never sees sign-in — sent to the dashboard. */
function AuthRoute() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && session) {
      navigate({ to: '/' });
    }
  }, [isPending, session, navigate]);

  if (isPending || session) {
    return <PageLoader />;
  }
  return <Outlet />;
}
