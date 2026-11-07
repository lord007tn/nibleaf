import { canAdminister } from '@nibleaf/shared/rbac';
import { useProjectMembers } from '@/hooks/api';
import { useSession } from '@/services/auth-client';

export type ProjectAdminStatus = 'pending' | 'admin' | 'not-admin';

/** A missing or failed membership lookup does not establish a person's role. */
export function useProjectAdminStatus(projectId: string | undefined) {
  const members = useProjectMembers(projectId);
  const session = useSession();
  const member = members.data?.members.find((candidate) => candidate.user.id === session.data?.user.id);
  const status: ProjectAdminStatus =
    !projectId || members.isPending || members.isError || session.isPending || !member
      ? 'pending'
      : canAdminister(member.role)
        ? 'admin'
        : 'not-admin';
  return { status, isError: members.isError, retrying: members.isFetching, retry: members.refetch };
}
