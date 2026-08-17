import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthProviders } from '@/components/auth-providers';
import { PageLoader } from '@/components/page-loader';
import { useSession } from '@/lib/auth-client';

export const Route = createFileRoute('/(auth)')({
  // Keep every auth utility page (sign-in/up, forgot/reset password, verify
  // email) out of search indexes — some carry live tokens in the URL. Children
  // inherit this; per-page heads only add a title.
  head: () => ({
    meta: [{ name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: AuthRoute,
});

/** Reverse guard: an authenticated user can never see sign-in/up — sent to /app. */
function AuthRoute() {
  return (
    <AuthProviders>
      <AuthGuard />
    </AuthProviders>
  );
}

function AuthGuard() {
  const { data: session, isPending } = useSession();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isPending && session) {
      navigate({ to: '/app' });
    }
  }, [isPending, session, navigate]);

  if (isPending || session) {
    return <PageLoader />;
  }
  return <Outlet />;
}
