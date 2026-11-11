import { rankOf } from '@nibleaf/shared/rbac';
import { isOrgAdminRole } from './roles';

/** The org the signed-in person belongs to, as the switcher knows it. */
export interface Membership {
  id: string;
  slug: string;
  orgRole: string;
}
export interface AdmissionGrant {
  projectId: string;
  name: string;
  role: string;
}

export interface InvitationInfo {
  id: string;
  email: string;
  orgRole: string;
  organizationId: string;
  organizationName: string;
  inviterName: string | null;
  grants: AdmissionGrant[];
  status: string;
  expired: boolean;
}

/** What accepting would change for someone already in the org (design §6.3.1). */
type InvitationNote = 'none' | 'alreadyMember' | 'becomeAdmin' | 'alreadyEverything';

/**
 * Every case of the accept page (design §6.3), as one value. The page renders
 * exactly one state: one heading, one message, the actions that fit it
 * (PUBLIC-09: no "You've been invited" above an error).
 */
export type InvitationState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'invalid' }
  | { kind: 'expired'; info: InvitationInfo }
  | { kind: 'used'; info: InvitationInfo; membership: Membership | null }
  | { kind: 'signedOut'; info: InvitationInfo }
  | { kind: 'wrongAccount'; info: InvitationInfo; signedInAs: string }
  | { kind: 'ready'; info: InvitationInfo; note: InvitationNote };

export function invitationState(input: {
  pending: boolean;
  /** HTTP status of a failed info request, if it failed. */
  errorStatus: number | null;
  info: InvitationInfo | null;
  session: { email: string } | null;
  memberships: Membership[];
}): InvitationState {
  if (input.pending) return { kind: 'loading' };
  if (!input.info) return input.errorStatus === 404 || input.errorStatus === null ? { kind: 'invalid' } : { kind: 'error' };
  const info = input.info;
  const membership = input.memberships.find((org) => org.id === info.organizationId) ?? null;
  if (info.status !== 'pending') return { kind: 'used', info, membership: input.session ? membership : null };
  if (info.expired) return { kind: 'expired', info };
  if (!input.session) return { kind: 'signedOut', info };
  if (input.session.email.trim().toLowerCase() !== info.email.trim().toLowerCase())
    return { kind: 'wrongAccount', info, signedInAs: input.session.email };
  return { kind: 'ready', info, note: invitationNote(info.orgRole, membership?.orgRole ?? null) };
}

function invitationNote(invitedOrgRole: string, currentOrgRole: string | null): InvitationNote {
  if (!currentOrgRole) return 'none';
  if (isOrgAdminRole(currentOrgRole)) return 'alreadyEverything';
  if (invitedOrgRole === 'admin') return 'becomeAdmin';
  return 'alreadyMember';
}

export interface JoinPreview {
  organizationId: string;
  organizationName: string;
  inviterName: string | null;
  grants: AdmissionGrant[];
  allowedDomain: string | null;
}

/** Whether the person already holds everything a link grants (design §6.4: "You already have this access"). */
export function hasEverything(
  grants: Array<{ projectId: string; role: string }>,
  orgRole: string | null,
  siteRoles: Record<string, string>,
): boolean {
  if (!orgRole) return false;
  if (isOrgAdminRole(orgRole)) return true;
  return grants.every((grant) => rankOf(siteRoles[grant.projectId] ?? '') >= rankOf(grant.role));
}

const emailInDomain = (email: string, domain: string | null) => !domain || email.trim().toLowerCase().endsWith(`@${domain.toLowerCase()}`);

/** Where "Open" goes for someone who already has the access: the one website, else the org's Websites. */
export type Landing = { projectId: string } | { organization: string };
const landingFor = (grants: Array<{ projectId: string }>, membership: Membership): Landing =>
  grants.length === 1 && grants[0] ? { projectId: grants[0].projectId } : { organization: membership.slug };

/** Every case of the join page (design §6.4) as one value. */
export type JoinState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'invalid' }
  | { kind: 'signedOut'; preview: JoinPreview }
  | { kind: 'wrongDomain'; preview: JoinPreview; signedInAs: string }
  | { kind: 'alreadyMember'; preview: JoinPreview; landing: Landing }
  | { kind: 'ready'; preview: JoinPreview; note: 'none' | 'alreadyMember' };

export function joinState(input: {
  pending: boolean;
  errorStatus: number | null;
  preview: JoinPreview | null;
  session: { email: string } | null;
  memberships: Membership[];
  /** The person's role on each website of the link's org they can open (only needed when they are a plain Member). */
  siteRoles: Record<string, string> | null;
}): JoinState {
  if (input.pending) return { kind: 'loading' };
  if (!input.preview) return input.errorStatus === 404 || input.errorStatus === null ? { kind: 'invalid' } : { kind: 'error' };
  const preview = input.preview;
  if (!input.session) return { kind: 'signedOut', preview };
  const membership = input.memberships.find((org) => org.id === preview.organizationId) ?? null;
  if (
    membership &&
    (isOrgAdminRole(membership.orgRole) || input.siteRoles) &&
    hasEverything(preview.grants, membership.orgRole, input.siteRoles ?? {})
  )
    return { kind: 'alreadyMember', preview, landing: landingFor(preview.grants, membership) };
  if (!emailInDomain(input.session.email, preview.allowedDomain)) return { kind: 'wrongDomain', preview, signedInAs: input.session.email };
  if (membership && !isOrgAdminRole(membership.orgRole) && !input.siteRoles) return { kind: 'loading' };
  return { kind: 'ready', preview, note: membership ? 'alreadyMember' : 'none' };
}
