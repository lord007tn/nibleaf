import { MemberRole } from './constants';

export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];
export const ASSIGNABLE_ORG_ROLES = ['admin', 'member'] as const;
export const ASSIGNABLE_SITE_ROLES = ['admin', 'member', 'viewer'] as const;

/** Organization membership alone gives ordinary members no website access. */
export const effectiveSiteRole = (orgRole: string, grantRole: string | null): MemberRole | null => {
  if (orgRole === 'owner') return MemberRole.OWNER;
  if (orgRole === 'admin') return MemberRole.ADMIN;
  if (orgRole !== 'member' || !ASSIGNABLE_SITE_ROLES.some((role) => role === grantRole)) return null;
  return grantRole as MemberRole;
};

/** Higher rank = more privilege. Unknown roles rank lowest. */
const ROLE_RANK: Record<string, number> = {
  [MemberRole.VIEWER]: 1,
  [MemberRole.MEMBER]: 2,
  [MemberRole.ADMIN]: 3,
  [MemberRole.OWNER]: 4,
};

export const rankOf = (role: string): number => ROLE_RANK[role] ?? 0;

/** Whether `role` is at least as privileged as `required`. */
export const roleAtLeast = (role: string, required: MemberRole): boolean => rankOf(role) >= rankOf(required);

/** Roles allowed to read a site's dashboard: content, drafts, history,
 *  analytics and (read-only) settings. Every real role qualifies. */
export const canView = (role: string): boolean => roleAtLeast(role, MemberRole.VIEWER);

/** Roles allowed to edit documentation content. Viewers are read-only. */
export const canEdit = (role: string): boolean => roleAtLeast(role, MemberRole.MEMBER);

/** Roles allowed to manage members, billing, domains, and danger-zone actions. */
export const canAdminister = (role: string): boolean => roleAtLeast(role, MemberRole.ADMIN);

/** Export policy constants are shared so API guards and permission tests cannot
 * drift: editors may create/cancel runs; only admins may manage schedules. */
export const EXPORT_CREATE_ROLE = MemberRole.MEMBER;
export const EXPORT_SCHEDULE_ROLE = MemberRole.ADMIN;

/** The roles that can be granted through invites and role changes. `owner` is
 *  deliberately absent: a workspace has exactly ONE owner, and ownership moves
 *  only through the explicit transfer-ownership flow (never by assigning the
 *  role directly). */
export const ASSIGNABLE_MEMBER_ROLES = [MemberRole.ADMIN, MemberRole.MEMBER, MemberRole.VIEWER] as const;
export type AssignableMemberRole = (typeof ASSIGNABLE_MEMBER_ROLES)[number];

/** Whether an actor may GRANT `targetRole` to someone. Two rules:
 *  1. `owner` is NEVER assignable — not even by the owner. Ownership changes
 *     hands only via the transfer-ownership flow, which atomically demotes the
 *     previous owner so exactly one owner exists at all times.
 *  2. Otherwise you can never grant a role more privileged than your own — so
 *     a member cannot mint admins. */
export const canAssignRole = (actorRole: string, targetRole: string): boolean =>
  targetRole !== MemberRole.OWNER && rankOf(actorRole) >= rankOf(targetRole);

/** Whether an actor may manage (change role of / remove) a member who currently
 *  holds `memberRole`. You cannot act on someone ranked above you; managing an
 *  owner therefore requires being an owner. */
export const canManageMember = (actorRole: string, memberRole: string): boolean => rankOf(actorRole) >= rankOf(memberRole);

// ─── Issuing invitations and join links ──────────────────────────────────────

/** An issuer as the issuer policy reads them: their org role and website grants. */
export interface InvitationIssuer {
  orgRole: string;
  projectGrants: ReadonlyArray<{ projectId: string; role: string }>;
}

/** Why an issuer could not issue an admission themselves: it gives organization
 *  access (org Admin, or no website at all), or a website they can't grant. */
export type IssuerRefusal = 'orgAccess' | 'otherWebsites';

/** Whether the viewer may resend a pending invitation from a website's Team
 *  page, as the server's issuer policy decides it. Older servers send nothing:
 *  read a missing value as `allowed`, and the resend itself stays the authority. */
export type InvitationResend = 'allowed' | IssuerRefusal;

/**
 * The issuer policy (`issuerAuthorizes` in @nibleaf/auth runs it for invitations,
 * resends, link previews and revocation): null when `issuer` could grant
 * `orgRole` and `grants` themselves, otherwise why not. Pure, so a list can
 * decide Resend up front without forking the rule.
 */
export const issuerRefusal = (
  issuer: InvitationIssuer,
  orgRole: string,
  grants: ReadonlyArray<{ projectId: string; role: string }>,
): IssuerRefusal | null => {
  if (!(ASSIGNABLE_ORG_ROLES as readonly string[]).includes(orgRole)) return 'orgAccess';
  const orgAdmin = issuer.orgRole === 'owner' || issuer.orgRole === 'admin';
  if (orgRole === 'admin' && !orgAdmin) return 'orgAccess';
  // A site administrator cannot invite a grantless organization member.
  if (!orgAdmin && grants.length === 0) return 'orgAccess';
  const grantable = grants.every((grant) => {
    if (!(ASSIGNABLE_SITE_ROLES as readonly string[]).includes(grant.role)) return false;
    const role = effectiveSiteRole(issuer.orgRole, issuer.projectGrants.find((g) => g.projectId === grant.projectId)?.role ?? null);
    return role !== null && canAssignRole(role, grant.role);
  });
  return grantable ? null : 'otherWebsites';
};

// ─── Ownership transfer ──────────────────────────────────────────────────────

export type OwnershipTransferRejection =
  | 'actor_not_found'
  | 'actor_not_owner'
  | 'target_is_actor'
  | 'target_not_found'
  | 'target_already_owner'
  | 'target_not_admin';

/** `demote` → every current owner becomes admin; `promote` → the target becomes owner. */
export type OwnershipTransferPlan = { ok: true; demote: string[]; promote: string } | { ok: false; reason: OwnershipTransferRejection };

/**
 * Pure decision logic for transferring workspace ownership. The invariant it
 * encodes: a workspace has exactly ONE owner. A transfer is only valid from
 * the current owner to an existing ADMIN, and the resulting plan demotes
 * EVERY current owner to admin (the actor, plus any extra owners left behind
 * by legacy data from before the single-owner rule) before promoting the
 * target — so the ending state is always exactly one owner.
 */
export const planOwnershipTransfer = (
  members: ReadonlyArray<{ id: string; role: string }>,
  actorMemberId: string,
  targetMemberId: string,
): OwnershipTransferPlan => {
  const actor = members.find((member) => member.id === actorMemberId);
  if (!actor) {
    return { ok: false, reason: 'actor_not_found' };
  }
  if (actor.role !== MemberRole.OWNER) {
    return { ok: false, reason: 'actor_not_owner' };
  }
  if (targetMemberId === actorMemberId) {
    return { ok: false, reason: 'target_is_actor' };
  }
  const target = members.find((member) => member.id === targetMemberId);
  if (!target) {
    return { ok: false, reason: 'target_not_found' };
  }
  if (target.role === MemberRole.OWNER) {
    return { ok: false, reason: 'target_already_owner' };
  }
  if (target.role !== MemberRole.ADMIN) {
    return { ok: false, reason: 'target_not_admin' };
  }
  return {
    ok: true,
    demote: members.filter((member) => member.role === MemberRole.OWNER).map((member) => member.id),
    promote: target.id,
  };
};
