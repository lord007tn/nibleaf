import { revokeJoinLinksBeyondRole } from '@nibleaf/auth/join-links';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { prisma } from '@nibleaf/database';
import { type EmailLanguage, renderMemberInvitationEmail } from '@nibleaf/email';
import { MemberRole } from '@nibleaf/shared/constants';
import { canAdminister, canAssignRole, canManageMember, effectiveSiteRole, planOwnershipTransfer } from '@nibleaf/shared/rbac';
import type { UpdateMemberRoleBody } from '@nibleaf/validators';
import { env } from '@/env';
import { conflict, forbidden, notFound } from '@/errors';
import { notificationEnabled } from './notifications';

const INVITE_TTL_DAYS = 7;

// TODO(organizations-admission): replace these 1:1 compatibility actions.
const singleProject = async (db: typeof prisma | import('@nibleaf/database').Prisma.TransactionClient, organizationId: string, mutating = false) => {
  if (mutating) {
    const organization = await db.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { needsRepair: true, deletionStartedAt: true },
    });
    if (organization.needsRepair || organization.deletionStartedAt) throw conflict('This organization cannot be changed right now.');
  }
  const projects = await db.project.findMany({ where: { organizationId }, select: { id: true }, take: 2 });
  if (projects.length !== 1 || !projects[0]) throw conflict('Use organization membership actions for this organization.');
  return projects[0].id;
};

const siteMember = async (
  tx: import('@nibleaf/database').Prisma.TransactionClient,
  organizationId: string,
  projectId: string,
  where: { userId: string } | { id: string },
) => {
  const member = await tx.member.findFirst({ where: { organizationId, ...where }, include: { projectGrants: { where: { projectId } } } });
  return member ? { ...member, role: effectiveSiteRole(member.orgRole, member.projectGrants[0]?.role ?? null) ?? '' } : null;
};

/** Public-safe metadata for an invitation, used by the accept page and sign-up prefill. */
export const getInvitationInfo = async (invitationId: string) => {
  const invitation = await prisma.invitation.findUnique({
    where: { id: invitationId },
    select: { id: true, email: true, kind: true, grants: { select: { role: true } }, status: true, expiresAt: true, organizationId: true },
  });
  if (!invitation) {
    throw notFound('invitation', { id: invitationId });
  }
  const org = await prisma.organization.findUnique({ where: { id: invitation.organizationId }, select: { name: true } });
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.kind === 'bootstrap_owner' ? 'owner' : (invitation.grants[0]?.role ?? 'viewer'),
    status: invitation.status,
    organizationName: org?.name ?? null,
    expired: invitation.expiresAt ? new Date(invitation.expiresAt).getTime() < Date.now() : false,
  };
};

export const listMembers = async (organizationId: string) => {
  const projectId = await singleProject(prisma, organizationId);
  const [members, invitations] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, email: true, image: true } }, projectGrants: { where: { projectId } } },
    }),
    prisma.invitation.findMany({
      where: { organizationId, status: 'pending' },
      include: { grants: { where: { projectId } } },
      orderBy: { id: 'desc' },
    }),
  ]);
  return {
    members: members.flatMap(({ projectGrants, ...member }) => {
      const role = effectiveSiteRole(member.orgRole, projectGrants[0]?.role ?? null);
      return role ? [{ ...member, role }] : [];
    }),
    invitations: invitations.map(({ grants, ...invitation }) => ({
      ...invitation,
      role: invitation.kind === 'bootstrap_owner' ? 'owner' : (grants[0]?.role ?? 'viewer'),
    })),
  };
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
    const owners = await prisma.member.count({ where: { organizationId, orgRole: MemberRole.OWNER } });
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
  const projectId = await singleProject(prisma, organizationId, true);
  const invitation = await prisma.invitation.create({
    data: {
      organizationId,
      email,
      role: 'viewer',
      kind: options.bootstrapOwner ? 'bootstrap_owner' : 'member',
      orgRole: options.bootstrapOwner ? 'owner' : 'member',
      status: 'pending',
      expiresAt,
      inviterId,
      ...(options.bootstrapOwner ? {} : { grants: { create: { organizationId, projectId, role: body.role } } }),
    },
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
    return { ...invitation, role: body.role };
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
  return { ...invitation, role: body.role };
};

export const updateMemberRole = async (organizationId: string, memberId: string, actorUserId: string, body: UpdateMemberRoleBody) => {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "organization" WHERE "id" = ${organizationId} FOR NO KEY UPDATE`;
    const projectId = await singleProject(tx, organizationId, true);
    const actor = await siteMember(tx, organizationId, projectId, { userId: actorUserId });
    if (!actor) throw forbidden('You are not a member of this workspace.');
    if (!canAdminister(actor.role)) throw forbidden('You do not have permission to manage workspace members.');
    const member = await siteMember(tx, organizationId, projectId, { id: memberId });
    if (!member) {
      throw notFound('member', { id: memberId });
    }
    // You can't act on a member ranked above you (e.g. an admin changing an owner)…
    if (!canManageMember(actor.role, member.role)) {
      throw forbidden('You cannot change the role of a member with a higher role than your own.');
    }
    // …nor promote anyone above your own rank (blocks admin→owner escalation).
    if (!canAssignRole(actor.role, body.role)) {
      throw forbidden('You cannot grant a role higher than your own.', { role: body.role });
    }
    // Never leave a workspace without an owner. `body.role` can no longer be
    // `owner` (the schema excludes it), so any role change on an owner row is a
    // demotion — blocked while they are the last owner, which under the
    // single-owner invariant is always; transfer-ownership is the only way the
    // owner role moves. The count keeps legacy multi-owner data demotable.
    if (member.role === MemberRole.OWNER) {
      const owners = await tx.member.count({ where: { organizationId, orgRole: MemberRole.OWNER } });
      if (owners <= 1) {
        throw conflict('You cannot demote the last owner of the workspace. Transfer ownership instead.');
      }
    }
    if (member.orgRole !== 'member') throw conflict('Change this role through organization membership actions.');
    await tx.member.update({ where: { id: memberId }, data: { role: 'viewer' } });
    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: member.userId } },
      create: { projectId, organizationId, userId: member.userId, role: body.role },
      update: { role: body.role },
    });
    const updated = { ...member, role: body.role };
    // Links they created that the new role can't grant stop working, in the same transaction.
    await revokeJoinLinksBeyondRole(tx, organizationId, member.userId, body.role);
    return updated;
  });
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
export const transferOwnership = async (organizationId: string, actorUserId: string, targetMemberId: string) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "organization" WHERE "id" = ${organizationId} FOR NO KEY UPDATE`;
    const projectId = await singleProject(tx, organizationId, true);
    const rows = await tx.member.findMany({ where: { organizationId }, include: { projectGrants: { where: { projectId } } } });
    const members = rows.map((member) => ({ ...member, role: effectiveSiteRole(member.orgRole, member.projectGrants[0]?.role ?? null) ?? '' }));
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

    await tx.member.updateMany({ where: { organizationId, orgRole: MemberRole.OWNER }, data: { role: MemberRole.ADMIN, orgRole: MemberRole.ADMIN } });
    // Former owners are Admins now; no link can carry owner, but keep the rule in one place.
    for (const previous of members.filter((member) => member.role === MemberRole.OWNER)) {
      await revokeJoinLinksBeyondRole(tx, organizationId, previous.userId, MemberRole.ADMIN);
    }
    return tx.member.update({
      where: { id: plan.promote },
      data: { role: MemberRole.OWNER, orgRole: MemberRole.OWNER },
      include: { user: { select: { id: true, name: true, email: true, image: true } } },
    });
  });

export const removeMember = async (organizationId: string, memberId: string, actorUserId: string) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "organization" WHERE "id" = ${organizationId} FOR NO KEY UPDATE`;
    const projectId = await singleProject(tx, organizationId, true);
    const actor = await siteMember(tx, organizationId, projectId, { userId: actorUserId });
    if (!actor) throw forbidden('You are not a member of this workspace.');
    if (!canAdminister(actor.role)) throw forbidden('You do not have permission to manage workspace members.');
    const member = await siteMember(tx, organizationId, projectId, { id: memberId });
    if (!member) {
      throw notFound('member', { id: memberId });
    }
    if (!canManageMember(actor.role, member.role)) {
      throw forbidden('You cannot remove a member with a higher role than your own.');
    }
    if (member.role === MemberRole.OWNER) {
      const owners = await tx.member.count({ where: { organizationId, orgRole: MemberRole.OWNER } });
      if (owners <= 1) {
        throw conflict('You cannot remove the last owner of the workspace.');
      }
    }
    await tx.member.delete({ where: { id: memberId } });
    // Someone who left the site keeps no working join link to it.
    await revokeJoinLinksBeyondRole(tx, organizationId, member.userId, null);
    return { id: memberId };
  });

export const cancelInvitation = async (organizationId: string, invitationId: string) => {
  await singleProject(prisma, organizationId, true);
  const invitation = await prisma.invitation.findFirst({ where: { id: invitationId, organizationId }, select: { id: true } });
  if (!invitation) {
    throw notFound('invitation', { id: invitationId });
  }
  await prisma.invitation.delete({ where: { id: invitationId } });
  return { id: invitationId };
};
