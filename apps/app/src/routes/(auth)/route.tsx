import { createFileRoute, Navigate, Outlet, redirect, useLocation } from '@tanstack/react-router';
import { AuthProviders } from '@/components/auth-providers';
import { getSessionFn } from '@/functions/session';
import { isOAuthAuthorizationSearch } from '@/lib/mcp-oauth';
import { useSession } from '@/services/auth-client';

export const Route = createFileRoute('/(auth)')({
  beforeLoad: async ({ location }) => {
    // An MCP OAuth request lands here when Better Auth wants a (fresh) sign-in;
    // Better Auth continues the flow after it, so never redirect to /app.
    // Imported lazily: beforeLoad is in the router's eager chunk, which published
    // docs pages load, and the auth pages load this module anyway.
    const oauth = await import('@/lib/mcp-oauth');
    if (oauth.isOAuthAuthorizationSearch(location.searchStr)) return;
    if (await getSessionFn()) {
      const firstPublish = location.pathname.endsWith('/sign-up') && new URLSearchParams(location.searchStr).get('intent') === 'first-publish';
      throw redirect({ to: '/app', search: firstPublish ? { firstPublish: true } : {} });
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
  const location = useLocation();

  // Do not replace the outlet while better-auth revalidates on window focus.
  // Unmounting here erased the email/OTP step when users switched to their inbox.
  if (session && !isOAuthAuthorizationSearch(location.searchStr)) {
    const firstPublish = location.pathname.endsWith('/sign-up') && new URLSearchParams(location.searchStr).get('intent') === 'first-publish';
    return <Navigate to="/app" search={firstPublish ? { firstPublish: true } : {}} />;
  }
  return <Outlet />;
}
