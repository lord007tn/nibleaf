import type { MessageKey } from '@nibleaf/i18n';
import { MemberRole } from '@nibleaf/shared/constants';

/** The name and one-line explanation shown for each role, wherever a role
 *  appears (pickers, member lists, invitations). Stored `member` is "Editor". */
export const ROLE_COPY: Record<MemberRole, { label: MessageKey; hint: MessageKey }> = {
  [MemberRole.OWNER]: { label: 'roles.owner', hint: 'roles.ownerHint' },
  [MemberRole.ADMIN]: { label: 'roles.admin', hint: 'roles.adminHint' },
  [MemberRole.MEMBER]: { label: 'roles.editor', hint: 'roles.editorHint' },
  [MemberRole.VIEWER]: { label: 'roles.viewer', hint: 'roles.viewerHint' },
};

const isKnownRole = (role: string): role is MemberRole => Object.hasOwn(ROLE_COPY, role);

/** Label key for any stored role. A value this version doesn't know says so
 *  ("Unknown role") instead of passing for Viewer; every server guard ranks it
 *  as the least privileged. A missing role reads as Viewer, as before. */
export const roleLabelKey = (role: string | null | undefined): MessageKey => {
  if (!role) return ROLE_COPY[MemberRole.VIEWER].label;
  return isKnownRole(role) ? ROLE_COPY[role].label : 'roles.unknown';
};
