import { revokeJoinLinksBeyondRole } from '@nibleaf/auth/join-links';
import { type Prisma, prisma } from '@nibleaf/database';
import type { EmailLanguage } from '@nibleaf/email';
import type { MemberRole } from '@nibleaf/shared/constants';
import { canAdminister, canAssignRole, effectiveSiteRole } from '@nibleaf/shared/rbac';
import { conflict, forbidden, notFound } from '@/errors';
import { assertUsableAccount } from '@/lib/access';
import { lockOrganization } from './admissions';
import { syncLegacyMembership } from './legacy-membership';
import { inviteOrganizationMembers, sendOrganizationInvitations, transferOrganizationOwnership, withOrganization } from './organizations';

const singleProject = async (organizationId: string, projectId?: string) => {
  const projects = await prisma.project.findMany({
    where: { organizationId, ...(projectId ? { id: projectId } : {}) },
    select: { id: true },
    take: 2,
  });
  if (projects.length !== 1 || !projects[0]) throw notFound('project');
  return projects[0].id;
};
export const getInvitationInfo = async (id: string) => {
  const invitation = await prisma.invitation.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      kind: true,
      orgRole: true,
      status: true,
      expiresAt: true,
      organization: { select: { name: true } },
      grants: { select: { role: true, project: { select: { name: true } } } },
    },
  });
  if (!invitation || !['pending', 'accepted'].includes(invitation.status)) throw notFound('invitation');
  return {
    id: invitation.id,
    email: invitation.email,
    orgRole: invitation.orgRole,
    role: invitation.kind === 'bootstrap_owner' ? 'owner' : invitation.orgRole === 'admin' ? 'admin' : (invitation.grants[0]?.role ?? 'viewer'),
    organizationName: invitation.organization.name,
    grants: invitation.grants.map((g) => ({ name: g.project.name, role: g.role })),
    status: invitation.status,
    expired: invitation.expiresAt <= new Date(),
  };
};
export const listMembers = async (organizationId: string, siteId?: string) => {
  const projectId = await singleProject(organizationId, siteId);
  const [members, invitations] = await Promise.all([
    prisma.member.findMany({
      where: { organizationId, OR: [{ orgRole: { in: ['owner', 'admin'] } }, { projectGrants: { some: { projectId } } }] },
      select: {
        id: true,
        userId: true,
        orgRole: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true, image: true } },
        projectGrants: { where: { projectId }, select: { role: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.invitation.findMany({
      where: { organizationId, status: 'pending', grants: { some: { projectId } } },
      select: { id: true, email: true, status: true, expiresAt: true, inviterId: true, grants: { where: { projectId }, select: { role: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  return {
    members: members.map(({ projectGrants, ...member }) => ({
      ...member,
      role: effectiveSiteRole(member.orgRole, projectGrants[0]?.role ?? null) ?? 'viewer',
      viaOrganization: member.orgRole !== 'member',
    })),
    invitations: invitations.map(({ grants, ...invitation }) => ({ ...invitation, role: grants[0]?.role ?? 'viewer' })),
  };
};
export const inviteMember = async (
  organizationId: string,
  inviterId: string,
  _actorRole: string,
  body: { email: string; role: MemberRole },
  options: { sendEmail?: boolean; bootstrapOwner?: boolean; language?: EmailLanguage; projectId?: string } = {},
) => {
  if (body.role === 'owner') {
    if (!options.bootstrapOwner) throw forbidden('Ownership is granted only through transfer.');
    const invitation = await prisma.$transaction(async (tx) => {
      await lockOrganization(tx, organizationId, true);
      const issuer = await assertUsableAccount(inviterId, tx);
      const staff = await tx.user.findUniqueOrThrow({ where: { id: issuer.id }, select: { role: true } });
      if (staff.role !== 'admin') throw forbidden('Platform administrator access required.');
      if (await tx.member.count({ where: { organizationId, orgRole: 'owner' } })) throw conflict('This organization already has an owner.');
      return tx.invitation.create({
        data: {
          organizationId,
          inviterId,
          email: body.email.trim().toLowerCase(),
          role: 'viewer',
          orgRole: 'owner',
          kind: 'bootstrap_owner',
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });
    });
    await sendOrganizationInvitations(organizationId, inviterId, [invitation], { orgRole: 'owner', grants: [] }, options);
    return invitation;
  }
  const projectId = await singleProject(organizationId, options.projectId);
  const result = await inviteOrganizationMembers(
    organizationId,
    inviterId,
    { emails: [body.email], orgRole: 'member', grants: [{ projectId, role: body.role }] },
    { ...options, siteProjectId: projectId },
  );
  const invitation = result.invitations[0];
  if (invitation) return { ...invitation, role: body.role };
  const existing = result.existingMembers[0];
  if (!existing) throw notFound('member');
  return { id: existing.userId, email: body.email, role: body.role, status: 'existing_member' };
};
const siteActor = async (tx: Prisma.TransactionClient, organizationId: string, projectId: string, userId: string) => {
  const member = await tx.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { projectGrants: { where: { projectId } } },
  });
  const role = member ? effectiveSiteRole(member.orgRole, member.projectGrants[0]?.role ?? null) : null;
  if (!role) throw notFound('project');
  if (!canAdminister(role)) throw forbidden('Website administrator access required.');
  return role;
};
export const updateMemberRole = async (organizationId: string, id: string, actorId: string, body: { role: string }, siteId?: string) => {
  const projectId = await singleProject(organizationId, siteId);
  return withOrganization(
    organizationId,
    actorId,
    async (tx) => {
      const role = await siteActor(tx, organizationId, projectId, actorId);
      if (!canAssignRole(role, body.role)) throw forbidden('You cannot grant this role.');
      const member = await tx.member.findFirst({ where: { id, organizationId } });
      if (!member) throw notFound('member');
      if (member.orgRole !== 'member') throw forbidden('This person has access via the organization.');
      const grant = await tx.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: member.userId } } });
      if (!grant) throw notFound('member');
      await tx.projectMember.update({ where: { id: grant.id }, data: { role: body.role } });
      await revokeJoinLinksBeyondRole(tx, organizationId, member.userId, body.role);
      await syncLegacyMembership(tx, organizationId, member.userId);
      return { id, role: body.role };
    },
    false,
  );
};
export const removeMember = async (organizationId: string, id: string, actorId: string, siteId?: string) => {
  const projectId = await singleProject(organizationId, siteId);
  return withOrganization(
    organizationId,
    actorId,
    async (tx) => {
      await siteActor(tx, organizationId, projectId, actorId);
      const member = await tx.member.findFirst({ where: { id, organizationId } });
      if (!member) throw notFound('member');
      if (member.orgRole !== 'member') throw forbidden('This person has access via the organization.');
      const removed = await tx.projectMember.deleteMany({ where: { organizationId, projectId, userId: member.userId } });
      if (!removed.count) throw notFound('member');
      await revokeJoinLinksBeyondRole(tx, organizationId, member.userId, null);
      // Zero grants left: the legacy row goes too, so a rollback cannot restore access.
      await syncLegacyMembership(tx, organizationId, member.userId);
      return { id };
    },
    false,
  );
};
export const cancelInvitation = async (organizationId: string, id: string, actorId: string, siteId?: string) => {
  const projectId = await singleProject(organizationId, siteId);
  return withOrganization(
    organizationId,
    actorId,
    async (tx) => {
      await siteActor(tx, organizationId, projectId, actorId);
      const removed = await tx.invitationGrant.deleteMany({ where: { invitationId: id, organizationId, projectId } });
      if (!removed.count) throw notFound('invitation');
      if (!(await tx.invitationGrant.count({ where: { invitationId: id } })))
        await tx.invitation.update({ where: { id }, data: { status: 'canceled' } });
      return { id };
    },
    false,
  );
};
export const transferOwnership = transferOrganizationOwnership;
