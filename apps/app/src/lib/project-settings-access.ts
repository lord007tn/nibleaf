import { canAdminister } from '@nibleaf/shared/rbac';

/**
 * Whether the signed-in person may manage this site's admin-only settings
 * (domain, integrations, billing…):
 * - `'admin'`: they can (Admin or Owner).
 * - `'notAdmin'`: they can't (Editor, or not on the site's team at all); offer
 *   "ask an Admin" instead.
 * - `'pending'`: not known yet, because the session or the team is loading, or
 *   the team failed to load. Unknown is not "no" (DATA_LOADING.md), so show
 *   neutral copy: neither the admin action nor the "ask an Admin" variant.
 */
export type SiteAdminState = 'pending' | 'admin' | 'notAdmin';

/** Decide {@link SiteAdminState} from the signed-in person's role on the site's
 *  team (`undefined` when they aren't on it) and whether that's still unknown. */
export function resolveProjectSettingsAccess(role: string | undefined, pending: boolean): SiteAdminState {
  if (pending) return 'pending';
  return canAdminister(role ?? '') ? 'admin' : 'notAdmin';
}
