import { createJob, QueueNames } from '@plume/bullmq';
import { prisma } from '@plume/database';
import type { InviteMemberBody, UpdateMemberRoleBody } from '@plume/validators';
import { env } from '@/env';
import { conflict, notFound } from '@/errors';

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

export const inviteMember = async (organizationId: string, inviterId: string, body: InviteMemberBody) => {
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

export const updateMemberRole = async (organizationId: string, memberId: string, body: UpdateMemberRoleBody) => {
  const member = await prisma.member.findFirst({ where: { id: memberId, organizationId } });
  if (!member) {
    throw notFound('member', { id: memberId });
  }
  return prisma.member.update({ where: { id: memberId }, data: { role: body.role } });
};

export const removeMember = async (organizationId: string, memberId: string) => {
  const member = await prisma.member.findFirst({ where: { id: memberId, organizationId }, select: { id: true, role: true } });
  if (!member) {
    throw notFound('member', { id: memberId });
  }
  if (member.role === 'owner') {
    throw conflict('You cannot remove the workspace owner.');
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
