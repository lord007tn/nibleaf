import { createFileRoute } from '@tanstack/react-router';
import { AiDashboard } from '@/components/ai-conversations/dashboard';
import { aiDashboardSearch } from '@/components/ai-conversations/search';
export const Route = createFileRoute('/app/projects/$projectId/ai')({
  validateSearch: (search) => aiDashboardSearch.parse(search),
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
