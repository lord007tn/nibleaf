import { queryOptions, skipToken } from '@tanstack/react-query';
import { getData } from '@/hooks/api/client-helpers';
import { api } from '@/services/api';
import { peopleKeys } from './keys';

/*
 * Query factories for people management. Loaders import this module, so it
 * stays light: no hooks, components, i18n or validators runtime (ui-overhaul §8.1).
 * Lists of people change from elsewhere (an invite gets accepted, someone
 * joins by link), so they refetch on focus and every 30 seconds (#421).
 */
const LIVE = { refetchOnWindowFocus: true, refetchInterval: 30_000 } as const;

export interface OrgInvitation {
  id: string;
  email: string;
  orgRole: 'admin' | 'member';
  createdAt: string;
  expiresAt: string;
  inviter: { id: string; name: string; email: string };
  grants: Array<{ projectId: string; role: string; project: { name: string } }>;
}

export const orgInvitationsQueryOptions = (organizationId: string | undefined) =>
  queryOptions({
    queryKey: peopleKeys.orgInvitations(organizationId ?? ''),
    queryFn: organizationId
      ? async () =>
          getData<OrgInvitation[]>(await api.app.organizations[':organizationId'].invitations.$get({ param: { organizationId } }), 'invitations')
      : skipToken,
    ...LIVE,
  });

const fetchOrgJoinLinks = async (organizationId: string) =>
  getData(await api.app.organizations[':organizationId']['join-links'].$get({ param: { organizationId } }), 'join links');
const fetchSiteJoinLinks = async (projectId: string) =>
  getData(await api.app.projects[':projectId']['join-links'].$get({ param: { projectId } }), 'join links');
/** One join link with its grants, creator, recent joins and status (the same shape at both levels). */
export type JoinLinkRecord = Awaited<ReturnType<typeof fetchOrgJoinLinks>>[number];

export const orgJoinLinksQueryOptions = (organizationId: string | undefined) =>
  queryOptions({
    queryKey: peopleKeys.orgJoinLinks(organizationId ?? ''),
    queryFn: organizationId ? () => fetchOrgJoinLinks(organizationId) : skipToken,
    ...LIVE,
  });

export const siteJoinLinksQueryOptions = (projectId: string | undefined) =>
  queryOptions({
    queryKey: peopleKeys.siteJoinLinks(projectId ?? ''),
    queryFn: projectId ? (): Promise<JoinLinkRecord[]> => fetchSiteJoinLinks(projectId) : skipToken,
    ...LIVE,
  });
