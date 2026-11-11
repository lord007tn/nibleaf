import { useProjectMembers } from '@/hooks/api';
import { useSession } from '@/services/auth-client';
import { type SiteAccess, siteAccessFromMembers } from '../model/access';

/** Query metadata is retained for the legacy useProjectAdminStatus contract. */
export function useSiteAccessQuery(projectId: string | undefined) {
  const members = useProjectMembers(projectId);
  const session = useSession();
  const role = members.data?.members.find((candidate) => candidate.user.id === session.data?.user.id)?.role;
  const isError = members.isError && !members.data;
  const pending = !projectId || members.isPending || !members.data || session.isPending || !session.data;
  const access = siteAccessFromMembers({
    members: members.data?.members,
    sessionUserId: session.data?.user.id,
    pending,
    failed: Boolean(projectId) && members.isError,
    cachedData: Boolean(members.data),
    retry: members.refetch,
  });
  return { access, role, isError, retrying: members.isFetching, retry: members.refetch };
}

/** Shares the existing members query; no additional endpoint or request. */
export function useSiteAccess(projectId: string | undefined): SiteAccess {
  return useSiteAccessQuery(projectId).access;
}
