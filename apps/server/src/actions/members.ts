import { createJob, QueueNames } from '@plume/bullmq';
import { prisma } from '@plume/database';
import { MemberRole } from '@plume/shared/constants';
import { canAssignRole, canManageMember } from '@plume/shared/rbac';
import type { InviteMemberBody, UpdateMemberRoleBody } from '@plume/validators';
import { env } from '@/env';
import { conflict, forbidden, notFound } from '@/errors';

const INVITE_TTL_DAYS = 7;

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

export const inviteMember = async (organizationId: string, inviterId: string, actorRole: string, body: InviteMemberBody) => {
  // An actor can never grant a role above their own — this is what stops an
  // admin from inviting someone straight in as an owner.
  if (!canAssignRole(actorRole, body.role)) {
    throw forbidden('You cannot invite a member with a role higher than your own.', { role: body.role });
  }
  const existing = await prisma.member.findFirst({
    where: { organizationId, user: { email: body.email } },
    select: { id: true },
  });
  if (existing) {
    throw conflict('That person is already a member of this workspace.', { email: body.email });
  }
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  const invitation = await prisma.invitation.create({
    data: { organizationId, email: body.email, role: body.role, status: 'pending', expiresAt, inviterId },
  });
  await createJob(QueueNames.EMAIL, {
    name: 'send-email',
    data: {
      to: body.email,
      subject: 'You have been invited to a Plume workspace',
      html: `<p>You have been invited to collaborate on documentation in Plume.</p><p><a href="${env.APP_URL}/accept-invite/${invitation.id}">Accept the invitation</a></p>`,
    },
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
  // Never leave a workspace without an owner.
  if (member.role === MemberRole.OWNER && body.role !== MemberRole.OWNER) {
    const owners = await prisma.member.count({ where: { organizationId, role: MemberRole.OWNER } });
    if (owners <= 1) {
      throw conflict('You cannot demote the last owner of the workspace.');
    }
  }
  return prisma.member.update({ where: { id: memberId }, data: { role: body.role } });
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
