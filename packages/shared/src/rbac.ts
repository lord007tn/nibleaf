import { MemberRole } from './constants';

/** Higher rank = more privilege. Unknown roles rank lowest. */
const ROLE_RANK: Record<string, number> = {
  [MemberRole.MEMBER]: 1,
  [MemberRole.ADMIN]: 2,
  [MemberRole.OWNER]: 3,
};

export const rankOf = (role: string): number => ROLE_RANK[role] ?? 0;

/** Whether `role` is at least as privileged as `required`. */
export const roleAtLeast = (role: string, required: MemberRole): boolean => rankOf(role) >= rankOf(required);

/** Roles allowed to edit documentation content. */
export const canEdit = (role: string): boolean => roleAtLeast(role, MemberRole.MEMBER);

/** Roles allowed to manage members, billing, domains, and danger-zone actions. */
export const canAdminister = (role: string): boolean => roleAtLeast(role, MemberRole.ADMIN);

/** Whether an actor may GRANT `targetRole` to someone. You can never grant a
 *  role more privileged than your own — so an admin cannot mint or promote to
 *  owner, and only an owner can assign the owner role. */
export const canAssignRole = (actorRole: string, targetRole: string): boolean => rankOf(actorRole) >= rankOf(targetRole);

/** Whether an actor may manage (change role of / remove) a member who currently
 *  holds `memberRole`. You cannot act on someone ranked above you; managing an
 *  owner therefore requires being an owner. */
export const canManageMember = (actorRole: string, memberRole: string): boolean => rankOf(actorRole) >= rankOf(memberRole);
