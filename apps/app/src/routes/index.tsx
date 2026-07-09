import { createFileRoute } from '@tanstack/react-router';
import { LandingPage } from '@/components/cloud-marketing';

export const Route = createFileRoute('/')({
  component: LandingPage,
});
