import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import type { OrgSection } from '@/components/app/org-sidebar';
import { PageLoader } from '@/components/page-loader';
import { QueryErrorState } from '@/components/query-error-state';
import { useSwitcher } from '@/hooks/api';

/**
 * Sends `/app` and the legacy account-wide pages into the landing organization
 * (§5.4.3): the last org opened if still a member, else the org you own, else
 * the oldest membership; nobody → `/app/welcome`. The server picks it (it
 * validates membership); the client never trusts a stored org id.
 */
export function LandingRedirect({ section, search }: { section: OrgSection; search?: Record<string, unknown> }) {
  const navigate = useNavigate();
  const switcher = useSwitcher();
  const landing = switcher.data?.landing;
  // Cached data counts too: a failed background refetch must not hold the loader forever.
  const empty = Boolean(switcher.data) && !landing;
  const slug = landing?.slug;

  useEffect(() => {
    if (slug) void navigate({ to: `/app/o/$orgSlug/${section}`, params: { orgSlug: slug }, search: search as never, replace: true });
    else if (empty) void navigate({ to: '/app/welcome', replace: true });
  }, [slug, empty, section, search, navigate]);

  if (switcher.isError && !switcher.data) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <QueryErrorState onRetry={() => void switcher.refetch()} retrying={switcher.isFetching} />
      </div>
    );
  }
  return <PageLoader />;
}
