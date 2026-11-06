import { createFileRoute } from '@tanstack/react-router';
import { AiSection } from '@/components/analytics/insights/ai-section';

export const Route = createFileRoute('/app/projects/$projectId/analytics/ai')({
  component: AiSection,
});
