import { canAdminister } from '@nibleaf/shared/rbac';
import { useProjectMembers } from '@/hooks/api';
import { useSession } from '@/services/auth-client';

/**
 * Whether the signed-in person may manage this site's admin-only settings
 * (domain, integrations, billing…):
 * - `'admin'`: they can (Admin or Owner).
 * - `'notAdmin'`: they can't (Editor); offer "ask an Admin" instead.
 * - `'pending'`: not known yet, because the session or the team is loading, or
 *   the team failed to load. Unknown is not "no" (DATA_LOADING.md), so show
 *   neutral copy: neither the admin action nor the "ask an Admin" variant.
 *
 * Shares the members query with any screen that lists the team, so it costs no
 * extra request there.
 */
export type SiteAdminState = 'pending' | 'admin' | 'notAdmin';

export function useSiteAdminState(projectId: string): SiteAdminState {
  const { data: session, isPending: sessionPending } = useSession();
  const { data: members } = useProjectMembers(projectId);
  if (sessionPending || !session || !members) return 'pending';
  const role = members.members.find((member) => member.user.id === session.user.id)?.role;
  return canAdminister(role ?? '') ? 'admin' : 'notAdmin';
}
