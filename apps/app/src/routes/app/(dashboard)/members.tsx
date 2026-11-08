import { createFileRoute, redirect } from '@tanstack/react-router';

// People are managed across all your sites on /app/people; keep old links working.
export const Route = createFileRoute('/app/(dashboard)/members')({
  beforeLoad: () => {
    throw redirect({ to: '/app/people', replace: true });
  },
});
