import { createFileRoute } from '@tanstack/react-router';
import { LandingRedirect } from '@/components/organization/landing-redirect';

// Cross-site analytics are per organization now (§5.1).
export const Route = createFileRoute('/app/analytics')({ component: () => <LandingRedirect section="analytics" /> });
