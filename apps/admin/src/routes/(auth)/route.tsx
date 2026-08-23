import { createFileRoute, Navigate, Outlet, redirect } from '@tanstack/react-router';
import { getSessionFn } from '@/functions/session';
import { useSession } from '@/services/auth-client';

export const Route = createFileRoute('/(auth)')({
  beforeLoad: async () => {
    if (await getSessionFn()) {
      throw redirect({ to: '/' });
    }
  },
  component: AuthRoute,
});

/** Reverse guard: a signed-in user never sees sign-in — sent to the dashboard. */
function AuthRoute() {
  const { data: session } = useSession();

  // Keep the OTP screen mounted while the session hook revalidates on focus.
  if (session) {
    return <Navigate to="/" />;
  }
  return <Outlet />;
}
