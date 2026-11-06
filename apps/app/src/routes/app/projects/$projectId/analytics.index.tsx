import { createFileRoute } from '@tanstack/react-router';
import { OverviewSection } from '@/components/analytics/insights/overview-section';

export const Route = createFileRoute('/app/projects/$projectId/analytics/')({
  component: OverviewSection,
});
