import type { MessageKey } from '@nibleaf/i18n';
import { canAdminister, rankOf } from '@nibleaf/shared/rbac';
import { type EffectiveSiteRole, isOrgAdminRole, type OrgRole } from './roles';

/**
 * Whether the viewer may do something, and if not, why (operations/ui-overhaul.md
 * §8.5). Components never compare roles themselves: they render a Decision.
 * Never-usable actions (a plain Member looking at admin tools) are not offered
 * at all; see `canManageOrgPeople` / `canManageSiteTeam`.
 */
export type Decision = { allowed: true } | { allowed: false; reason: MessageKey };

const allow: Decision = { allowed: true };
const deny = (reason: MessageKey): Decision => ({ allowed: false, reason });

/** The signed-in person on an org page. */
export interface OrgViewer {
  userId: string;
  orgRole: OrgRole;
}
/** A row on the org Members page. */
export interface OrgTarget {
  userId: string;
  orgRole: string;
}

export type OrgAction = 'manageAccess' | 'remove' | 'transferOwnership';

/** Members, invitations and join links of an org are for its Owner and Admins (design §4.1). */
export const canManageOrgPeople = (viewer: Pick<OrgViewer, 'orgRole'>) => isOrgAdminRole(viewer.orgRole);

export function canOnOrgMember(viewer: OrgViewer, action: OrgAction, target: OrgTarget): Decision {
  if (!canManageOrgPeople(viewer)) return deny('people.reason.adminOnly');
  const self = viewer.userId === target.userId;
  switch (action) {
    case 'manageAccess':
      if (target.orgRole === 'owner') return deny('people.reason.ownerRoleByTransfer');
      if (self) return deny('people.reason.ownRole');
      return allow;
    case 'remove':
      if (target.orgRole === 'owner') return deny('people.reason.ownerCannotBeRemoved');
      if (self) return deny('people.reason.leaveInstead');
      return allow;
    default:
      if (viewer.orgRole !== 'owner') return deny('people.reason.onlyOwnerTransfers');
      if (self) return deny('people.reason.alreadyOwner');
      if (target.orgRole !== 'admin') return deny('people.reason.transferToAdmin');
      return allow;
  }
}

/** The signed-in person on a website's Team page: their effective role there. */
export interface SiteViewer {
  userId: string;
  role: EffectiveSiteRole | null;
}
/** A row on the website Team page. */
export interface SiteTarget {
  userId: string;
  role: string;
  viaOrganization: boolean;
}
export type SiteAction = 'changeRole' | 'remove';

/** Adding people and changing grants on a website is for its Admins, incl. org Owner/Admins (design §4.2). */
export const canManageSiteTeam = (viewer: Pick<SiteViewer, 'role'>) => Boolean(viewer.role && canAdminister(viewer.role));

export function canOnSiteMember(viewer: SiteViewer, action: SiteAction, target: SiteTarget): Decision {
  if (!viewer.role || !canManageSiteTeam(viewer)) return deny('people.reason.siteAdminOnly');
  if (target.viaOrganization) return deny('people.reason.viaOrganization');
  if (viewer.userId === target.userId) return deny(action === 'remove' ? 'people.reason.removeSelfSite' : 'people.reason.ownRole');
  if (rankOf(target.role) > rankOf(viewer.role)) return deny('people.reason.moreAccess');
  return allow;
}
