import type { MessageKey } from '@nibleaf/i18n';
import { rankOf } from '@nibleaf/shared/rbac';

/** Organization roles (design §2). The Owner changes hands only by transfer. */
export type OrgRole = 'owner' | 'admin' | 'member';
/** Roles an org Owner/Admin can give in the organization. */
export type AssignableOrgRole = 'admin' | 'member';
/** Website roles a grant can hold. Stored `member` is "Editor" in the UI. */
export type SiteRole = 'admin' | 'member' | 'viewer';
/** What a person can do on one website: their grant, or Owner/Admin through the organization. */
export type EffectiveSiteRole = 'owner' | SiteRole;

export interface RoleOption<Role extends string> {
  role: Role;
  label: MessageKey;
  description: MessageKey;
}

/** The org role picker, least access first. Owner is never offered. */
export const ORG_ROLE_OPTIONS: readonly RoleOption<AssignableOrgRole>[] = [
  { role: 'member', label: 'people.orgRole.member', description: 'people.orgRole.memberHint' },
  { role: 'admin', label: 'people.orgRole.admin', description: 'people.orgRole.adminHint' },
];

/** The website role picker, least access first. */
export const SITE_ROLE_OPTIONS: readonly RoleOption<SiteRole>[] = [
  { role: 'viewer', label: 'roles.viewer', description: 'roles.viewerHint' },
  { role: 'member', label: 'roles.editor', description: 'roles.editorHint' },
  { role: 'admin', label: 'roles.admin', description: 'roles.adminHint' },
];

/** Email invitations give Editor by default (design §6.1). */
export const DEFAULT_INVITE_SITE_ROLE: SiteRole = 'member';
/** Anyone holding a join link gets it, so links default to the least access (WORKSPACE-12). */
export const DEFAULT_JOIN_LINK_SITE_ROLE: SiteRole = 'viewer';

const ORG_ROLE_LABEL: Record<OrgRole, MessageKey> = {
  owner: 'people.orgRole.owner',
  admin: 'people.orgRole.admin',
  member: 'people.orgRole.member',
};
const SITE_ROLE_LABEL: Record<EffectiveSiteRole, MessageKey> = {
  owner: 'roles.owner',
  admin: 'roles.admin',
  member: 'roles.editor',
  viewer: 'roles.viewer',
};

const isOrgRole = (role: string): role is OrgRole => role === 'owner' || role === 'admin' || role === 'member';
export const isSiteRole = (role: string): role is SiteRole => role === 'admin' || role === 'member' || role === 'viewer';
export const isOrgAdminRole = (role: string) => role === 'owner' || role === 'admin';

/** A label for any stored org role; something this version doesn't know says so. */
export const orgRoleLabel = (role: string): MessageKey => (isOrgRole(role) ? ORG_ROLE_LABEL[role] : 'roles.unknown');
/** A label for any stored site role; something this version doesn't know says so. */
export const siteRoleLabel = (role: string): MessageKey =>
  role === 'owner' || isSiteRole(role) ? SITE_ROLE_LABEL[role as EffectiveSiteRole] : 'roles.unknown';

/** Higher first: owner, admin, member, unknown. */
export const orgRoleOrder = (role: string) => (role === 'owner' ? 0 : role === 'admin' ? 1 : role === 'member' ? 2 : 3);

/** The site roles `actor` may hand out: never above their own (`canAssignRole`, design §4.2). */
export const assignableSiteRoles = (actor: EffectiveSiteRole): SiteRole[] =>
  SITE_ROLE_OPTIONS.map((option) => option.role).filter((role) => rankOf(actor) >= rankOf(role));

/** Admin or Editor through a link anyone can forward deserves a second look. */
export const isElevatedLinkRole = (role: SiteRole) => role !== 'viewer';
