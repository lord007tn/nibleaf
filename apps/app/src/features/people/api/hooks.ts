import { useQuery } from '@tanstack/react-query';
import { orgInvitationsQueryOptions } from './query-options';

/** The organization's pending invitations (Owner/Admin). Undefined id: nothing is fetched. */
export const useOrgInvitations = (organizationId: string | undefined) => useQuery(orgInvitationsQueryOptions(organizationId));
