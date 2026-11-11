import { createFileRoute } from '@tanstack/react-router';
import { AuthProviders } from '@/components/auth-providers';
import { AcceptInvitationView } from '@/features/people/components/admission';
import { getInvitationInfoQueryOptions } from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';

export const Route = createFileRoute('/accept-invite/$invitationId')({
  loader: ({ context: { queryClient }, params: { invitationId } }) => prefetchRouteData(queryClient, getInvitationInfoQueryOptions(invitationId)),
  // Not under the (auth) layout, so noindex it directly: the URL carries a live
  // invitation token that must never be crawled or indexed. The page sets a
  // title for the state it shows (invalid, expired, join <org>…).
  head: () => ({
    meta: [{ title: 'Invitation — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }],
  }),
  component: AcceptInvitePage,
});

/** Top-level so it resolves whether or not the user is authenticated. */
function AcceptInvitePage() {
  const { invitationId } = Route.useParams();
  return (
    <AuthProviders>
      <AcceptInvitationView invitationId={invitationId} />
    </AuthProviders>
  );
}
