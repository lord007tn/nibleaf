import { createFileRoute } from '@tanstack/react-router';
import { LandingRedirect } from '@/components/organization/landing-redirect';

// The account-wide sites list became each organization's Websites (§5.1); keep old links (and ?newSite) working.
export const Route = createFileRoute('/app/sites')({
  validateSearch: (search: Record<string, unknown>): { newSite?: boolean } =>
    search.newSite === true || search.newSite === 'true' ? { newSite: true } : {},
  component: SitesRedirect,
});

function SitesRedirect() {
  const { newSite } = Route.useSearch();
  return <LandingRedirect search={newSite ? { newSite: true } : undefined} section="websites" />;
}
