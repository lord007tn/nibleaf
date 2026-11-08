import { createFileRoute, Navigate, Outlet, redirect, useLocation, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { AuthProviders } from '@/components/auth-providers';
import { getSessionFn } from '@/functions/session';
import { afterAuthDestination } from '@/lib/invitations';
import { isOAuthAuthorizationSearch } from '@/lib/mcp-oauth';
import { useSession } from '@/services/auth-client';

const isFirstPublishSignUp = (pathname: string, searchStr: string) =>
  pathname.endsWith('/sign-up') && new URLSearchParams(searchStr).get('intent') === 'first-publish';

// A signed-in visitor of an auth page goes back to the page that sent them to
// authenticate (an invitation, named in the URL or remembered), else to the
// dashboard. The sign-in/up pages navigate to the same place once the code is
// verified. Before, this layout sent everyone to `/app` and won the race against
// the page's own invitation redirect whenever the invitation lookup was slower
// than the session refresh: the new member landed on an empty dashboard and the
// invitation was dropped.
export const Route = createFileRoute('/(auth)')({
  beforeLoad: async ({ location }) => {
    // An MCP OAuth request lands here when Better Auth wants a (fresh) sign-in;
    // Better Auth continues the flow after it, so never redirect to /app, and
    // never wait for the session lookup it doesn't use.
    // Imported lazily: beforeLoad is in the router's eager chunk, which published
    // docs pages load, and the auth pages load this module anyway. The session
    // lookup starts at the same time, so on other visits the import adds no wait.
    const session = getSessionFn();
    const oauth = await import('@/lib/mcp-oauth');
    if (oauth.isOAuthAuthorizationSearch(location.searchStr)) {
      session.catch(() => undefined);
      return;
    }
    if (await session) {
      // Lazily too, for the same reason; only signed-in visitors of an auth page need it.
      const invitations = await import('@/lib/invitations');
      const destination = invitations.afterAuthDestination({ invite: new URLSearchParams(location.searchStr).get('invite') });
      if (destination) throw redirect({ href: destination });
      throw redirect({ to: '/app', search: isFirstPublishSignUp(location.pathname, location.searchStr) ? { firstPublish: true } : {} });
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

/** Reverse guard: an authenticated user can never see sign-in/up — sent on to where they were going. */
function AuthRoute() {
  return (
    <AuthProviders>
      <AuthGuard />
    </AuthProviders>
  );
}

/** Replace the current entry with an in-app path (an invitation today, a join link later). */
function GoTo({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    router.history.replace(href);
  }, [router, href]);
  return null;
}

function AuthGuard() {
  const { data: session } = useSession();
  const location = useLocation();

  // Do not replace the outlet while better-auth revalidates on window focus.
  // Unmounting here erased the email/OTP step when users switched to their inbox.
  if (session && !isOAuthAuthorizationSearch(location.searchStr)) {
    // While the page's own redirect is under way, the router already reports the
    // next location (no ?invite=, maybe nothing remembered): stay out of its way.
    if (!/^\/(sign-in|sign-up|verify-email|forgot-password|reset-password)\/?$/.test(location.pathname)) return null;
    const destination = afterAuthDestination({ invite: new URLSearchParams(location.searchStr).get('invite') });
    if (destination) return <GoTo href={destination} />;
    return <Navigate to="/app" search={isFirstPublishSignUp(location.pathname, location.searchStr) ? { firstPublish: true } : {}} />;
  }
  return <Outlet />;
}
