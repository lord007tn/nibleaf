import { createJob, QueueNames } from '@nibleaf/bullmq';
import { prisma } from '@nibleaf/database';
import { type EmailLanguage, renderMemberInvitationEmail } from '@nibleaf/email';
import { MemberRole } from '@nibleaf/shared/constants';
import { canAssignRole, canManageMember, planOwnershipTransfer } from '@nibleaf/shared/rbac';
import type { UpdateMemberRoleBody } from '@nibleaf/validators';
import { env } from '@/env';
import { conflict, forbidden, notFound } from '@/errors';
import { notificationEnabled } from './notifications';

const INVITE_TTL_DAYS = 7;

/** Public-safe metadata for an invitation, used by the accept page and sign-up prefill. */
export const getInvitationInfo = async (invitationId: string) => {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { id: true, email: true, role: true, status: true, expiresAt: true, organizationId: true },
  });
  if (!invitation) {
    throw notFound('invitation', { id: invitationId });
  }
  const org = await prisma.organization.findUnique({ where: { id: invitation.organizationId }, select: { name: true } });
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    organizationName: org?.name ?? null,
    expired: invitation.expiresAt ? new Date(invitation.expiresAt).getTime() < Date.now() : false,
  };
};

export const listMembers = async (organizationId: string) => {
  const [members, invitations] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    }),
    prisma.invitation.findMany({ where: { organizationId, status: 'pending' }, orderBy: { id: 'desc' } }),
  ]);
  return { members, invitations };
};

export const inviteMember = async (
  organizationId: string,
  inviterId: string,
  actorRole: string,
  // Wider than `InviteMemberBody` (whose schema excludes `owner`) so the
  // platform-admin bootstrap below can mint a brand-new org's FIRST owner.
  body: { email: string; role: MemberRole },
  options: { sendEmail?: boolean; bootstrapOwner?: boolean; language?: EmailLanguage } = {},
) => {
  if (body.role === MemberRole.OWNER) {
    // Single-owner rule: `owner` can never be granted through a workspace
    // invitation (the API schema already rejects it; this guards direct
    // callers). The ONE exception is the platform-admin bootstrap of a
    // freshly created org (`bootstrapOwner`), which invites the org's first
    // owner — and even that refuses to mint a second owner.
    if (!options.bootstrapOwner) {
      throw forbidden('The owner role cannot be granted by invitation. Transfer ownership instead.', { role: body.role });
    }
    const owners = await prisma.member.count({ where: { organizationId, role: MemberRole.OWNER } });
    if (owners > 0) {
      throw conflict('This workspace already has an owner.');
    }
  } else if (!canAssignRole(actorRole, body.role)) {
    // An actor can never grant a role above their own — this is what stops a
    // member from inviting someone straight in as an admin.
    throw forbidden('You cannot invite a member with a role higher than your own.', { role: body.role });
  }
  // Normalize casing to match better-auth's case-insensitive acceptance check and
  // keep the invitations table free of near-duplicate addresses.
  const email = body.email.trim().toLowerCase();
  const existing = await prisma.member.findFirst({
    where: { organizationId, user: { email } },
    select: { id: true },
  });
  if (existing) {
    throw conflict('That person is already a member of this workspace.', { email });
  }
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const invitation = await prisma.invitation.create({
    data: { organizationId, email, role: body.role, status: 'pending', expiresAt, inviterId },
  });

  // Send a descriptive email naming the site, inviter and role. Delivery is
  // best-effort: the invite also works as a copy-able link (returned to the UI),
  // so a stock self-host without SMTP still has a working invite path.
  const [org, inviter] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, metadata: true } }),
    prisma.user.findUnique({ where: { id: inviterId }, select: { name: true, email: true } }),
  ]);
  // Respect the workspace's "member invited" notification toggle — when off, the
  // invitation is still created (the copy-able accept link is returned), we just
  // don't send the email.
  if (options.sendEmail === false || !notificationEnabled(org?.metadata, 'member_invited')) {
    return invitation;
  }
  const acceptUrl = `${env.APP_URL}/accept-invite/${invitation.id}`;
  const siteName = org?.name ?? 'a Nibleaf workspace';
  const inviterName = inviter?.name || inviter?.email || 'A teammate';
  const message = await renderMemberInvitationEmail({
    acceptUrl,
    days: INVITE_TTL_DAYS,
    inviterName,
    language: options.language,
    organizationName: siteName,
    role: body.role,
  });
  await createJob(QueueNames.EMAIL, {
    name: 'send-email',
    data: { to: email, ...message },
  }).catch(() => undefined);
  return invitation;
};

export const updateMemberRole = async (organizationId: string, memberId: string, actorRole: string, body: UpdateMemberRoleBody) => {
  const member = await prisma.member.findFirst({ where: { id: memberId, organizationId } });
  if (!member) {
    throw notFound('member', { id: memberId });
  }
  // You can't act on a member ranked above you (e.g. an admin changing an owner)…
  if (!canManageMember(actorRole, member.role)) {
    throw forbidden('You cannot change the role of a member with a higher role than your own.');
  }
  // …nor promote anyone above your own rank (blocks admin→owner escalation).
  if (!canAssignRole(actorRole, body.role)) {
    throw forbidden('You cannot grant a role higher than your own.', { role: body.role });
  }
  // Never leave a workspace without an owner. `body.role` can no longer be
  // `owner` (the schema excludes it), so any role change on an owner row is a
  // demotion — blocked while they are the last owner, which under the
  // single-owner invariant is always; transfer-ownership is the only way the
  // owner role moves. The count keeps legacy multi-owner data demotable.
  if (member.role === MemberRole.OWNER) {
    const owners = await prisma.member.count({ where: { organizationId, role: MemberRole.OWNER } });
    if (owners <= 1) {
      throw conflict('You cannot demote the last owner of the workspace. Transfer ownership instead.');
    }
  }
  return prisma.member.update({ where: { id: memberId }, data: { role: body.role } });
};

/**
 * Transfer workspace ownership — the ONLY path to the owner role (invites and
 * role changes reject `owner` at both the schema and rbac layer). Rules, all
 * enforced by the pure `planOwnershipTransfer`:
 *  - only the current owner may transfer (the route is owner-guarded too);
 *  - the target must be an existing member with role `admin`;
 *  - never to yourself.
 *
 * Data-integrity guard: the transaction demotes EVERY member currently holding
 * `owner` (not just the actor) before promoting the target, so even if legacy
 * data contains multiple owners, the ending state is always exactly one owner.
 */
export const transferOwnership = async (organizationId: string, actorUserId: string, targetMemberId: string) => {
  const members = await prisma.member.findMany({ where: { organizationId }, select: { id: true, userId: true, role: true } });
  const actor = members.find((member) => member.userId === actorUserId);
  const plan = planOwnershipTransfer(members, actor?.id ?? '', targetMemberId);
  if (!plan.ok) {
    switch (plan.reason) {
      case 'actor_not_found':
        throw forbidden('You are not a member of this workspace.');
      case 'actor_not_owner':
        throw forbidden('Only the current owner can transfer ownership.');
      case 'target_is_actor':
        throw conflict('Choose another member to transfer ownership to.');
      case 'target_not_found':
        throw notFound('member', { id: targetMemberId });
      case 'target_already_owner':
        throw conflict('That member is already an owner.');
      case 'target_not_admin':
        throw conflict('Ownership can only be transferred to an admin. Make them an admin first.');
      default:
        throw conflict('Ownership transfer could not be completed.');
    }
  }

  // One transaction: demote all current owners → admin, then promote the target.
  const [, promoted] = await prisma.$transaction([
    prisma.member.updateMany({ where: { id: { in: plan.demote }, organizationId }, data: { role: MemberRole.ADMIN } }),
    prisma.member.update({
      where: { id: plan.promote },
      data: { role: MemberRole.OWNER },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    }),
  ]);
  return promoted;
};

export const removeMember = async (organizationId: string, memberId: string, actorRole: string) => {
  const member = await prisma.member.findFirst({ where: { id: memberId, organizationId }, select: { id: true, role: true } });
  if (!member) {
    throw notFound('member', { id: memberId });
  }
  if (!canManageMember(actorRole, member.role)) {
    throw forbidden('You cannot remove a member with a higher role than your own.');
  }
  if (member.role === MemberRole.OWNER) {
    const owners = await prisma.member.count({ where: { organizationId, role: MemberRole.OWNER } });
    if (owners <= 1) {
      throw conflict('You cannot remove the last owner of the workspace.');
    }
  }
  await prisma.member.delete({ where: { id: memberId } });
  return { id: memberId };
};

export const cancelInvitation = async (organizationId: string, invitationId: string) => {
  const invitation = await prisma.invitation.findFirst({ where: { id: invitationId, organizationId }, select: { id: true } });
  if (!invitation) {
    throw notFound('invitation', { id: invitationId });
  }
  await prisma.invitation.delete({ where: { id: invitationId } });
  return { id: invitationId };
};
