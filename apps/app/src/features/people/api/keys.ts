import { organizationKeys } from '@/hooks/api/organization-keys';
import { queryKeys } from '@/hooks/api/query-keys';

/*
 * People query keys (operations/ui-overhaul.md §8.1). Existing tuples are kept
 * exactly: org members stay under the organization prefix (so invalidating an
 * organization reaches them) and website members stay under ['members', id].
 */
export const peopleKeys = {
  orgMembers: organizationKeys.organizations.members,
  orgInvitations: (organizationId: string) => ['organizations', organizationId, 'invitations'] as const,
  orgJoinLinks: (organizationId: string) => ['organizations', organizationId, 'join-links'] as const,
  orgWebsites: (organizationId: string) => organizationKeys.organizations.projects(organizationId, 'list'),
  siteTeam: queryKeys.members.forProject,
  siteJoinLinks: queryKeys.members.joinLinks,
} as const;
