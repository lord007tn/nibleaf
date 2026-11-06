import { createFileRoute } from '@tanstack/react-router';
import { FeedbackSection } from '@/components/analytics/insights/feedback-section';

export const Route = createFileRoute('/app/projects/$projectId/analytics/feedback')({
  component: FeedbackSection,
});
