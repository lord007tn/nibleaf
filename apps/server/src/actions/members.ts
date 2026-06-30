import { createJob, QueueNames } from '@midad/bullmq';
import { prisma } from '@midad/database';
import { MemberRole } from '@midad/shared/constants';
import { canAssignRole, canManageMember } from '@midad/shared/rbac';
import type { InviteMemberBody, UpdateMemberRoleBody } from '@midad/validators';
import { env } from '@/env';
import { conflict, forbidden, notFound } from '@/errors';
import { notificationEnabled } from './notifications';

const INVITE_TTL_DAYS = 7;

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);

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

export const inviteMember = async (organizationId: string, inviterId: string, actorRole: string, body: InviteMemberBody) => {
  // An actor can never grant a role above their own — this is what stops an
  // admin from inviting someone straight in as an owner.
  if (!canAssignRole(actorRole, body.role)) {
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
  if (!notificationEnabled(org?.metadata, 'member_invited')) {
    return invitation;
  }
  const acceptUrl = `${env.APP_URL}/accept-invite/${invitation.id}`;
  const siteName = org?.name ?? 'a Midad workspace';
  const inviterName = inviter?.name || inviter?.email || 'A teammate';
  const subject = `${inviterName} invited you to ${siteName} on Midad`;
  const text = [
    `${inviterName} invited you to join ${siteName} as ${body.role} on Midad.`,
    '',
    'Accept your invitation:',
    acceptUrl,
    '',
    `This invitation expires in ${INVITE_TTL_DAYS} days.`,
  ].join('\n');
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
  <h2 style="font-size:18px;margin:0 0 12px">You're invited to ${escapeHtml(siteName)}</h2>
  <p style="margin:0 0 16px;color:#475569;line-height:1.6"><strong>${escapeHtml(inviterName)}</strong> invited you to collaborate on documentation in <strong>${escapeHtml(siteName)}</strong> as <strong>${escapeHtml(body.role)}</strong> on Midad.</p>
  <p style="margin:0 0 24px"><a href="${acceptUrl}" style="display:inline-block;background:#5546e8;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Accept invitation</a></p>
  <p style="margin:0 0 8px;color:#94a3b8;font-size:13px">Or paste this link into your browser:</p>
  <p style="margin:0 0 16px;font-size:13px"><a href="${acceptUrl}" style="color:#5546e8">${acceptUrl}</a></p>
  <p style="margin:0;color:#94a3b8;font-size:12px">This invitation expires in ${INVITE_TTL_DAYS} days.</p>
</div>`;
  await createJob(QueueNames.EMAIL, {
    name: 'send-email',
    data: { to: email, subject, html, text },
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

export const transferOwnership = async (organizationId: string, actorUserId: string, targetMemberId: string) => {
  const [actor, target] = await Promise.all([
    prisma.member.findUnique({ where: { organizationId_userId: { organizationId, userId: actorUserId } } }),
    prisma.member.findFirst({
      where: { id: targetMemberId, organizationId },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    }),
  ]);
  if (!actor) {
    throw forbidden('You are not a member of this workspace.');
  }
  if (actor.role !== MemberRole.OWNER) {
    throw forbidden('Only the current owner can transfer ownership.');
  }
  if (!target) {
    throw notFound('member', { id: targetMemberId });
  }
  if (target.userId === actorUserId) {
    throw conflict('Choose another member to transfer ownership to.');
  }
  if (target.role === MemberRole.OWNER) {
    throw conflict('That member is already an owner.');
  }

  const [, promoted] = await prisma.$transaction([
    prisma.member.update({ where: { id: actor.id }, data: { role: MemberRole.ADMIN } }),
    prisma.member.update({
      where: { id: target.id },
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
