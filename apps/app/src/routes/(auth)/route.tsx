import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSession } from '@/lib/auth-client';

export const Route = createFileRoute('/(auth)')({
  component: AuthRoute,
});

/** Reverse guard: an authenticated user can never see sign-in/up — sent to /app. */
function AuthRoute() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && session) {
      navigate({ to: '/app' });
    }
  }, [isPending, session, navigate]);

  if (isPending || session) {
    return <div className="grid min-h-screen place-items-center bg-background text-muted-foreground text-sm">Loading…</div>;
  }
  return <Outlet />;
}

