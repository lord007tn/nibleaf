import { createFileRoute } from '@tanstack/react-router';
import { CloudPage } from '@/components/cloud-marketing';

export const Route = createFileRoute('/cloud')({
  component: CloudPage,
});
