import { createFileRoute } from '@tanstack/react-router';
import { AiDashboard } from '@/components/ai-conversations/dashboard';
import { aiDashboardSearch } from '@/components/ai-conversations/search';

export const Route = createFileRoute('/app/projects/$projectId/ai')({
  validateSearch: (search) => aiDashboardSearch.parse(search),
  loaderDeps: ({ search }) => search,
  // Start the active tab's queries on navigation (or link hover) without
  // holding it: the dashboard renders its skeleton at once.
  loader: ({ context: { queryClient }, params: { projectId }, deps: search }) => {
    // The queries load lazily so their schemas stay out of the main chunk. If the
    // chunk fails to load, the dashboard fetches on render instead.
    if (typeof window !== 'undefined')
      void import('@/hooks/api/ai-conversations')
        .then((queries) => queries.prefetchAiDashboard(queryClient, projectId, search))
        .catch(() => undefined);
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
