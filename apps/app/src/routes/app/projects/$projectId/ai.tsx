import type { QueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { AiDashboard } from '@/components/ai-conversations/dashboard';
import { type AiDashboardSearch, aiDashboardSearch, conversationFilters } from '@/components/ai-conversations/search';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';

/** The factories load lazily so their schemas stay out of the main chunk. */
const prefetchAiDashboard = async (queryClient: QueryClient, projectId: string, search: AiDashboardSearch) => {
  try {
    const queries = await import('@/hooks/api/ai-conversations');
    prefetchRouteData(queryClient, queries.aiConversationSummaryQueryOptions(projectId, search.range, search.language));
    if (search.tab === 'gaps') prefetchRouteData(queryClient, queries.aiContentGapsQueryOptions(projectId, search.range, search.language));
    if (search.conversation) prefetchRouteData(queryClient, queries.aiConversationQueryOptions(projectId, search.conversation));
    // prefetchInfiniteQuery never throws; a failure shows through the list's own query.
    if (search.tab === 'conversations')
      await queryClient.prefetchInfiniteQuery(queries.aiConversationsQueryOptions(projectId, conversationFilters(search)));
  } catch {
    // The chunk failed to load; the dashboard fetches on render instead.
  }
};

export const Route = createFileRoute('/app/projects/$projectId/ai')({
  validateSearch: (search) => aiDashboardSearch.parse(search),
  loaderDeps: ({ search }) => search,
  // Start the active tab's queries on navigation (or link hover) without
  // holding it: the dashboard renders its skeleton at once.
  loader: ({ context: { queryClient }, params: { projectId }, deps: search }) => {
    if (typeof window !== 'undefined') void prefetchAiDashboard(queryClient, projectId, search);
  },
  component: AiRoute,
});
function AiRoute() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AiDashboard
      projectId={projectId}
      search={search}
      onChange={(patch, replace = false) => {
        void navigate({ search: (previous) => ({ ...previous, ...patch }), replace });
      }}
    />
  );
}
