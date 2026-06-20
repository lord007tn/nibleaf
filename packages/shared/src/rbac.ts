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
