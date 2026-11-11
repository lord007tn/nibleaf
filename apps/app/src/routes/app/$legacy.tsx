import { createFileRoute } from '@tanstack/react-router';
import type { OrgSection } from '@/components/app/org-sidebar';
import { NotFound } from '@/components/not-found';
import { LandingRedirect } from '@/components/organization/landing-redirect';

// Account-wide pages became per-organization pages (§5.1). One route keeps every
// old link working (and keeps the route tree, which public pages load, small).
const LEGACY: Record<string, OrgSection> = { sites: 'websites', people: 'members', members: 'members', analytics: 'analytics' };

export const Route = createFileRoute('/app/$legacy')({
  // Read through the router (never `window`), so this also renders on the server.
  validateSearch: (search: Record<string, unknown>): { newSite?: true } =>
    search.newSite === true || search.newSite === 'true' ? { newSite: true } : {},
  component: LegacyRedirect,
});

function LegacyRedirect() {
  const { legacy } = Route.useParams();
  const { newSite: requested } = Route.useSearch();
  const section = LEGACY[legacy];
  if (!section) return <NotFound />;
  // /app/sites?newSite=true still opens "New website" in the landing org.
  const newSite = section === 'websites' && requested === true;
  return <LandingRedirect search={newSite ? { newSite: true } : undefined} section={section} />;
}
