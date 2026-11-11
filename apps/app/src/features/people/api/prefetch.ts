import type { QueryClient } from '@tanstack/react-query';
import { organizationMembersQueryOptions, organizationProjectsQueryOptions } from '@/hooks/api/organization-query-options';
import { prefetchRouteData } from '@/integrations/tanstack-query/query-client';
import { orgInvitationsQueryOptions, orgJoinLinksQueryOptions } from './query-options';

/** Everything the org Members page shows, fetched in parallel from the route loader (Owner/Admin only). */
export function prefetchOrgPeople(queryClient: QueryClient, organizationId: string) {
  prefetchRouteData(queryClient, organizationMembersQueryOptions(organizationId));
  prefetchRouteData(queryClient, orgInvitationsQueryOptions(organizationId));
  prefetchRouteData(queryClient, orgJoinLinksQueryOptions(organizationId));
  prefetchRouteData(queryClient, organizationProjectsQueryOptions(organizationId));
}
