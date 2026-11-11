import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { NotFound } from '@/components/not-found';
import { OrganizationContext } from '@/components/organization/organization-context';
import { isAccessLoss, useAccessLoss } from '@/components/organization/use-access-loss';
import { QueryErrorState } from '@/components/query-error-state';
import { useSwitcher } from '@/hooks/api';
import { organizationBySlugQueryOptions, switcherQueryOptions } from '@/hooks/api/organization-query-options';
import { useRecordVisitEffect } from '@/hooks/use-record-visit';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { useSessionQueryClient } from '@/integrations/tanstack-query/session-cache';
import { OrganizationLayout } from '@/layouts/organization';

const subscribeToHydration = () => () => undefined;

export const Route = createFileRoute('/app/o/$orgSlug')({
  loader: ({ context: { queryClient }, params: { orgSlug } }) => {
    prefetchRouteData(queryClient, organizationBySlugQueryOptions(orgSlug));
    prefetchRouteData(queryClient, switcherQueryOptions());
  },
  component: OrganizationRoute,
});

/**
 * Resolves `$orgSlug` once (by-slug, members only: an unknown slug and a
 * non-member get the same not-found page), redirects an old handle to the
 * current one, and turns losing access while viewing into a redirect home.
 */
function OrganizationRoute() {
  const { orgSlug } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useSessionQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.searchStr });
  // Refetch on focus: the cheapest way to notice a removal in a background tab.
  const organization = useQuery({ ...organizationBySlugQueryOptions(orgSlug), refetchOnWindowFocus: true });
  const refetchOrganization = organization.refetch;
  const switcher = useSwitcher();
  const { lostOrganization } = useAccessLoss();
  // The query can resolve before this streamed route hydrates: render the server's loading tree until then.
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const data = hydrated ? organization.data : undefined;
  const lost = isAccessLoss(organization.error);
  const cachedName = data?.name ?? switcher.data?.organizations.find((org) => org.slug === orgSlug)?.name;
  useRecordVisitEffect({ organizationId: data && !lost ? data.id : undefined });

  // `/app/o/$orgSlug` itself is the org's Websites page (§5.1).
  useEffect(() => {
    if (/^\/app\/o\/[^/]+\/?$/.test(pathname)) void navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug }, replace: true });
  }, [pathname, orgSlug, navigate]);

  // An alias (old handle) redirects to the current handle, keeping the rest of the URL.
  useEffect(() => {
    if (!data || lost || data.slug === orgSlug) return;
    const rest = pathname.slice(`/app/o/${orgSlug}`.length);
    void navigate({ to: `/app/o/${data.slug}${rest}${search}` as never, replace: true });
  }, [data, lost, orgSlug, pathname, search, navigate]);

  // Moving between this org's pages often needs no request (fresh cache), so re-check
  // membership with the tiny by-slug read on each navigation inside the org.
  const visited = useRef<string | null>(null);
  useEffect(() => {
    // Only while staying in this org: leaving it on purpose (delete, leave) must not trigger the lost-access path.
    const inOrganization = pathname.startsWith(`/app/o/${orgSlug}/`);
    if (visited.current !== null && visited.current !== pathname && inOrganization) void refetchOrganization();
    visited.current = pathname;
  }, [pathname, orgSlug, refetchOrganization]);

  // Any org-scoped request answering 404 means access may be gone: re-check the org itself.
  const organizationId = data?.id;
  useEffect(() => {
    if (!organizationId) return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'error') return;
      const [scope, id] = event.query.queryKey as unknown[];
      if (scope === 'organizations' && id === organizationId && isAccessLoss(event.action.error)) void refetchOrganization();
    });
  }, [organizationId, queryClient, refetchOrganization]);

  useEffect(() => {
    if (lost && cachedName && pathname.startsWith(`/app/o/${orgSlug}`)) lostOrganization(cachedName);
  }, [lost, cachedName, lostOrganization, pathname, orgSlug]);

  if (lost && !cachedName) return <NotFound />;
  if (organization.isError && !lost && !data) {
    return (
      <div className="grid min-h-screen place-items-center p-6">
        <QueryErrorState onRetry={() => void organization.refetch()} retrying={organization.isFetching} />
      </div>
    );
  }
  return (
    <OrganizationLayout orgSlug={orgSlug} organization={lost ? undefined : data}>
      {data && !lost ? (
        <OrganizationContext.Provider value={data}>
          <Outlet />
        </OrganizationContext.Provider>
      ) : (
        <OrganizationPageSkeleton />
      )}
    </OrganizationLayout>
  );
}

function OrganizationPageSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <div className="h-8 w-48 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {['a', 'b', 'c'].map((card) => (
          <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40 motion-reduce:animate-none" key={card} />
        ))}
      </div>
    </div>
  );
}
