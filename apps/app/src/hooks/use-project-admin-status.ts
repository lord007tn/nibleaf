import { canAdminister } from '@nibleaf/shared/rbac';
import { useProjectMembers } from '@/hooks/api';
import { useSession } from '@/services/auth-client';

export type ProjectAdminStatus = 'pending' | 'admin' | 'not-admin';

/** Cached membership remains usable when a background refetch fails. */
export function useProjectAdminStatus(projectId: string | undefined) {
  const members = useProjectMembers(projectId);
  const session = useSession();
  const member = members.data?.members.find((candidate) => candidate.user.id === session.data?.user.id);
  const isError = members.isError && !members.data;
  const status: ProjectAdminStatus =
    !projectId || members.isPending || isError || session.isPending || !member ? 'pending' : canAdminister(member.role) ? 'admin' : 'not-admin';
  return { status, isError, retrying: members.isFetching, retry: members.refetch };
}
