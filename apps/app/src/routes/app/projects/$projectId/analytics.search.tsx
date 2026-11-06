import { createFileRoute } from '@tanstack/react-router';
import { SearchSection } from '@/components/analytics/insights/search-section';

export const Route = createFileRoute('/app/projects/$projectId/analytics/search')({
  component: SearchSection,
});
