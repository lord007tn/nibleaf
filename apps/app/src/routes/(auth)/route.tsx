import { createFileRoute, Navigate, Outlet, redirect } from '@tanstack/react-router';
import { AuthProviders } from '@/components/auth-providers';
import { useSession } from '@/lib/auth-client';
import { getRouteSession } from '@/lib/route-session';

export const Route = createFileRoute('/(auth)')({
  beforeLoad: async () => {
    if (await getRouteSession()) {
      throw redirect({ to: '/app' });
    }
  },
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
  const { data: session } = useSession();

  // Do not replace the outlet while better-auth revalidates on window focus.
  // Unmounting here erased the email/OTP step when users switched to their inbox.
  if (session) {
    return <Navigate to="/app" />;
  }
  return <Outlet />;
}
