import { createFileRoute } from '@tanstack/react-router';
import { PricingPage } from '@/components/cloud-marketing';

export const Route = createFileRoute('/pricing')({
  component: PricingPage,
});
