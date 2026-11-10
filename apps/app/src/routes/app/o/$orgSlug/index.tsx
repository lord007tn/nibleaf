import { createFileRoute, redirect } from '@tanstack/react-router';

// `/app/o/$orgSlug` is the org's Websites page (§5.1).
export const Route = createFileRoute('/app/o/$orgSlug/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/app/o/$orgSlug/websites', params, replace: true });
  },
});
