import { createFileRoute } from '@tanstack/react-router';
import { PagesSection } from '@/components/analytics/insights/pages-section';

export const Route = createFileRoute('/app/projects/$projectId/analytics/pages')({
  component: PagesRoute,
  // `?path=guide/install` opens that page's drill-down; without it the full table shows.
  validateSearch: (search: Record<string, unknown>): { path?: string } =>
    typeof search.path === 'string' && search.path.trim() ? { path: search.path.trim().slice(0, 512) } : {},
});

function PagesRoute() {
  const { path } = Route.useSearch();
  return <PagesSection path={path} />;
}
