import { createFileRoute } from '@tanstack/react-router';
import { PerformanceSection } from '@/components/analytics/insights/performance-section';

export const Route = createFileRoute('/app/projects/$projectId/analytics/performance')({
  component: PerformanceSection,
});
