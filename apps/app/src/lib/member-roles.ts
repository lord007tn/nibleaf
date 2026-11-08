import type { MessageKey } from '@nibleaf/i18n';
import { MemberRole } from '@nibleaf/shared/constants';
import type { AssignableMemberRole } from '@nibleaf/shared/rbac';

/** The name and one-line explanation shown for each role, wherever a role
 *  appears (pickers, member lists, invitations). Stored `member` is "Editor". */
export const ROLE_COPY: Record<MemberRole, { label: MessageKey; hint: MessageKey }> = {
  [MemberRole.OWNER]: { label: 'roles.owner', hint: 'roles.ownerHint' },
  [MemberRole.ADMIN]: { label: 'roles.admin', hint: 'roles.adminHint' },
  [MemberRole.MEMBER]: { label: 'roles.editor', hint: 'roles.editorHint' },
  [MemberRole.VIEWER]: { label: 'roles.viewer', hint: 'roles.viewerHint' },
};

/** Roles a picker offers, least access first. `owner` is never offered: it
 *  moves only through transfer-ownership. */
export const ROLE_PICKER_ORDER: readonly AssignableMemberRole[] = [MemberRole.VIEWER, MemberRole.MEMBER, MemberRole.ADMIN];

/** Invitations default to Editor, as before the Viewer role existed. */
export const DEFAULT_INVITE_ROLE: AssignableMemberRole = MemberRole.MEMBER;

const isKnownRole = (role: string): role is MemberRole => role in ROLE_COPY;

/** Label key for any stored role. An unrecognised value reads as the least
 *  privileged role, which is also how every server guard ranks it. */
export const roleLabelKey = (role: string | null | undefined): MessageKey => ROLE_COPY[role && isKnownRole(role) ? role : MemberRole.VIEWER].label;
