import { canAdminister, canEdit } from '@nibleaf/shared/rbac';

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

/**
 * Whether the signed-in person may change this site's content (pages, drafts,
 * publishing):
 * - `'edit'`: they can (Editor, Admin or Owner).
 * - `'viewOnly'`: they are a Viewer (or not on the site's team), so the
 *   editor is read-only and write controls are disabled with an explanation.
 * - `'pending'`: not known yet. Screens keep write controls locked but say
 *   nothing, so a Viewer never types into a draft that cannot be saved.
 * - `'unknown'`: the team failed to load and nothing is cached. Write
 *   controls stay locked (unknown is not "yes"), and screens offer a retry.
 */
export type SiteEditState = 'pending' | 'edit' | 'viewOnly' | 'unknown';

export function resolveProjectEditAccess(role: string | undefined, pending: boolean, failed = false): SiteEditState {
  if (failed) return 'unknown';
  if (pending) return 'pending';
  return canEdit(role ?? '') ? 'edit' : 'viewOnly';
}
