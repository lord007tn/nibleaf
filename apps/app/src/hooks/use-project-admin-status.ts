import { useProjectMembers } from '@/hooks/api';
import { resolveProjectSettingsAccess, type SiteAdminState } from '@/lib/project-settings-access';
import { useSession } from '@/services/auth-client';

/**
 * The signed-in person's {@link SiteAdminState} on a site, plus the members
 * query's error and retry so a screen can offer "try again".
 *
 * Someone signed in but missing from the loaded team is `'notAdmin'`: the server
 * only lets members of the site's own team at or above Admin administer it.
 * Cached membership remains usable when a background refetch fails.
 *
 * Shares the members query with any screen that lists the team, so it costs no
 * extra request there.
 */
export function useProjectAdminStatus(projectId: string | undefined) {
  const members = useProjectMembers(projectId);
  const session = useSession();
  const isError = members.isError && !members.data;
  const role = members.data?.members.find((candidate) => candidate.user.id === session.data?.user.id)?.role;
  const status: SiteAdminState = resolveProjectSettingsAccess(
    role,
    !projectId || members.isPending || !members.data || session.isPending || !session.data,
  );
  return { status, isError, retrying: members.isFetching, retry: members.refetch };
}
