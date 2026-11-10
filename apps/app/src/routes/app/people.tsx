import { createFileRoute } from '@tanstack/react-router';
import { LandingRedirect } from '@/components/organization/landing-redirect';

// People are managed per organization now (§5.1): old /app/people links open the landing org's Members.
export const Route = createFileRoute('/app/people')({ component: () => <LandingRedirect section="members" /> });
