import { createFileRoute } from '@tanstack/react-router';
import { AuthProviders } from '@/components/auth-providers';
import { JoinLinkView } from '@/features/people/components/admission';
import { getPublicMetaQueryOptions, joinLinkPreviewQueryOptions } from '@/hooks/api/query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';

export const Route = createFileRoute('/join/$token')({
  // <html lang dir> follows the interface language (lib/root-document.ts).
  staticData: { interfaceLocale: true },
  loader: ({ context: { queryClient }, params: { token } }) => {
    prefetchRouteData(queryClient, joinLinkPreviewQueryOptions(token));
    prefetchRouteData(queryClient, getPublicMetaQueryOptions());
  },
  // The URL is a live credential: never crawl or index it. The page sets a
  // title for the state it shows.
  head: () => ({ meta: [{ title: 'Join link — Nibleaf' }, { name: 'robots', content: 'noindex, nofollow' }] }),
  component: JoinPage,
});

/** Top-level, outside the (auth) layout, so it works signed in or out. */
function JoinPage() {
  const { token } = Route.useParams();
  return (
    <AuthProviders>
      <JoinLinkView token={token} />
    </AuthProviders>
  );
}
