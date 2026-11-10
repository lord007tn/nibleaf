import { type AdmissionGrant, issuerAuthorizes, revokeJoinLinksBeyondRole } from '@nibleaf/auth/join-links';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { type Invitation, Prisma, prisma } from '@nibleaf/database';
import { type EmailLanguage, renderMemberInvitationEmail } from '@nibleaf/email';
import { generateJoinLinkToken, hashJoinLinkToken } from '@nibleaf/shared/crypto';
import { joinLinkPath, joinLinkStatus } from '@nibleaf/shared/join-links';
import { planOwnershipTransfer } from '@nibleaf/shared/rbac';
import { env } from '@/env';
import { conflict, forbidden, notFound } from '@/errors';
import { assertUsableAccount } from '@/lib/access';
import { applyAdmission, lockOrganization } from './admissions';
import { syncLegacyMembership } from './legacy-membership';
import { notificationEnabled } from './notifications';

type Tx = Prisma.TransactionClient;
const userSelect = { id: true, name: true, email: true, image: true } as const;
const grantsInclude = { project: { select: { id: true, name: true } } } as const;
const isAdmin = (role: string) => role === 'owner' || role === 'admin';
const orgDto = (org: { id: string; slug: string; name: string; logo: string | null }, orgRole: string) => ({
  id: org.id,
  slug: org.slug,
  name: org.name,
  logo: org.logo,
  orgRole,
  canCreateWebsite: isAdmin(orgRole),
});

export async function withOrganization<T>(
  organizationId: string,
  actorId: string,
  action: (tx: Tx, org: Awaited<ReturnType<typeof lockOrganization>>, actor: { id: string; orgRole: string }) => Promise<T>,
  admin = true,
) {
  return prisma.$transaction(async (tx) => {
    const org = await lockOrganization(tx, organizationId);
    await assertUsableAccount(actorId, tx);
    const actor = await tx.member.findUnique({ where: { organizationId_userId: { organizationId, userId: actorId } } });
    if (!actor) throw notFound('organization');
    if (admin && !isAdmin(actor.orgRole)) throw forbidden('Organization administrator access required.');
    return action(tx, org, actor);
  });
}

/** PR 1 keeps one website per organization, and the previous release reads any
 * membership as site access, so an org member always holds at least one grant
 * (design §10.1). Removing the last grant removes the membership instead. */
const noWebsites = () => conflict('Choose at least one website, or remove this person instead.');
export async function validateOrganizationGrants(tx: Tx, organizationId: string, grants: AdmissionGrant[]) {
  if (grants.some((g) => !['admin', 'member', 'viewer'].includes(g.role))) throw forbidden('Invalid website role.');
  if (new Set(grants.map((g) => g.projectId)).size !== grants.length) throw conflict('Each website may appear only once.');
  const projects = await tx.project.count({ where: { organizationId, id: { in: grants.map((g) => g.projectId) } } });
  if (projects !== grants.length) throw notFound('project');
}

export const listOrganizations = async (userId: string) => {
  const members = await prisma.member.findMany({
    where: { userId },
    include: { organization: { select: { id: true, slug: true, name: true, logo: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return members.map((m) => orgDto(m.organization, m.orgRole));
};
export const getOrganization = async (userId: string, organizationId: string) => {
  const member = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    include: { organization: { select: { id: true, slug: true, name: true, logo: true } } },
  });
  if (!member) throw notFound('organization');
  return orgDto(member.organization, member.orgRole);
};
export const organizationBySlug = async (userId: string, slug: string) => {
  const handle = await prisma.organizationHandle.findUnique({ where: { slug }, select: { organizationId: true } });
  if (!handle) throw notFound('organization');
  return getOrganization(userId, handle.organizationId);
};
export const updateOrganization = (organizationId: string, actorId: string, body: { name?: string; logo?: string | null; slug?: string }) =>
  withOrganization(organizationId, actorId, async (tx, org, actor) => {
    if (body.slug && body.slug !== org.slug) {
      const existing = await tx.organizationHandle.findUnique({ where: { slug: body.slug } });
      if (existing && existing.organizationId !== org.id) throw conflict('This organization handle is already taken.');
      await tx.organizationHandle.upsert({
        where: { slug: org.slug },
        create: { slug: org.slug, organizationId: org.id, current: false },
        update: { current: false },
      });
      await tx.organizationHandle.updateMany({ where: { organizationId }, data: { current: false } });
      if (existing) await tx.organizationHandle.update({ where: { slug: body.slug, organizationId }, data: { current: true } });
      else await tx.organizationHandle.create({ data: { slug: body.slug, organizationId, current: true } });
    }
    const updated = await tx.organization.update({ where: { id: organizationId }, data: body });
    return orgDto(updated, actor.orgRole);
  }).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict('This organization handle is already taken.');
    throw error;
  });
export const listOrganizationMembers = async (organizationId: string) =>
  prisma.member.findMany({
    where: { organizationId },
    select: { id: true, userId: true, orgRole: true, createdAt: true, user: { select: userSelect }, projectGrants: { include: grantsInclude } },
    orderBy: { createdAt: 'asc' },
  });

export const inviteOrganizationMembers = async (
  organizationId: string,
  actorId: string,
  body: { emails: string[]; orgRole: 'admin' | 'member'; grants: AdmissionGrant[] },
  options: { siteProjectId?: string; sendEmail?: boolean; language?: EmailLanguage } = {},
) => {
  const result = await withOrganization(
    organizationId,
    actorId,
    async (tx) => {
      await validateOrganizationGrants(tx, organizationId, body.grants);
      if (body.orgRole === 'member' && !body.grants.length) throw noWebsites();
      if (options.siteProjectId && (body.orgRole !== 'member' || body.grants.length !== 1 || body.grants[0]?.projectId !== options.siteProjectId))
        throw forbidden('Invite from the organization to grant additional access.');
      if (!(await issuerAuthorizes(tx, organizationId, actorId, body.orgRole, body.grants))) throw forbidden('You cannot grant this access.');
      const invitations: Invitation[] = [];
      const existingMembers: Array<{ userId: string; email: string; changed: boolean }> = [];
      for (const email of [...new Set(body.emails.map((e) => e.trim().toLowerCase()))]) {
        const member = await tx.member.findFirst({ where: { organizationId, user: { email: { equals: email, mode: 'insensitive' } } } });
        if (member) {
          const changed =
            options.siteProjectId && isAdmin(member.orgRole)
              ? false
              : (await applyAdmission(tx, organizationId, member.userId, body.orgRole, body.grants, actorId)).changed;
          existingMembers.push({ userId: member.userId, email, changed });
        } else {
          const invite = await tx.invitation.create({
            data: {
              organizationId,
              inviterId: actorId,
              email,
              orgRole: body.orgRole,
              role: 'viewer',
              kind: 'member',
              status: 'pending',
              expiresAt: new Date(Date.now() + 7 * 86_400_000),
              grants: { create: body.grants.map(({ projectId, role }) => ({ projectId, role })) },
            },
          });
          invitations.push(invite);
        }
      }
      return { invitations, existingMembers };
    },
    !options.siteProjectId,
  );
  await sendOrganizationInvitations(organizationId, actorId, result.invitations, body, options);
  return result;
};

export async function sendOrganizationInvitations(
  organizationId: string,
  actorId: string,
  invitations: Array<{ id: string; email: string }>,
  body: { orgRole: string; grants: AdmissionGrant[] },
  options: { sendEmail?: boolean; language?: EmailLanguage },
) {
  if (options.sendEmail !== false && invitations.length) {
    const [org, inviter, projects] = await Promise.all([
      prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, metadata: true } }),
      prisma.user.findUniqueOrThrow({ where: { id: actorId }, select: { name: true } }),
      prisma.project.findMany({ where: { organizationId, id: { in: body.grants.map((g) => g.projectId) } }, select: { id: true, name: true } }),
    ]);
    if (notificationEnabled(org.metadata, 'member_invited'))
      for (const invitation of invitations) {
        const message = await renderMemberInvitationEmail({
          acceptUrl: `${env.APP_URL}/accept-invite/${invitation.id}`,
          days: 7,
          inviterName: inviter.name,
          organizationName: org.name,
          role: body.orgRole,
          organizationRole: true,
          grants: body.grants.map((grant) => ({ name: projects.find((p) => p.id === grant.projectId)?.name ?? '', role: grant.role })),
          language: options.language,
        });
        await createJob(QueueNames.EMAIL, {
          name: 'send-email',
          data: { to: invitation.email, ...message },
        }).catch(() => undefined);
      }
  }
}

/** Only a pending invitation can be revoked. An accepted one already made a
 *  membership (remove the member instead); revoking it must never report a
 *  removal that did not happen. Runs under the org lock, so it serializes with
 *  acceptance. */
export const assertRevocable = (invitation: { status: string; expiresAt: Date } | null) => {
  if (!invitation) throw notFound('invitation');
  if (invitation.status === 'accepted')
    throw conflict('This invitation was already accepted. Remove the member instead.', { reason: 'invitation_accepted' });
  if (invitation.status !== 'pending') throw conflict('This invitation is no longer pending.', { reason: 'invitation_not_pending' });
};
export const cancelOrganizationInvitation = (organizationId: string, actorId: string, id: string) =>
  withOrganization(organizationId, actorId, async (tx) => {
    assertRevocable(await tx.invitation.findFirst({ where: { id, organizationId }, select: { status: true, expiresAt: true } }));
    await tx.invitation.update({ where: { id }, data: { status: 'canceled' } });
    return { id };
  });
const targetMember = async (tx: Tx, organizationId: string, id: string) => {
  const member = await tx.member.findFirst({ where: { id, organizationId } });
  if (!member) throw notFound('member');
  if (member.orgRole === 'owner') throw forbidden('Use ownership transfer to change the owner.');
  return member;
};
const replaceGrants = async (tx: Tx, organizationId: string, userId: string, grants: AdmissionGrant[], actorId: string) => {
  await validateOrganizationGrants(tx, organizationId, grants);
  await tx.projectMember.deleteMany({ where: { organizationId, userId } });
  if (grants.length) await tx.projectMember.createMany({ data: grants.map((g) => ({ ...g, organizationId, userId, createdById: actorId })) });
};
export const updateOrganizationMember = (
  organizationId: string,
  actorId: string,
  id: string,
  body: { orgRole: 'admin' | 'member'; grants?: AdmissionGrant[] },
) =>
  withOrganization(organizationId, actorId, async (tx) => {
    const member = await targetMember(tx, organizationId, id);
    if (member.orgRole === 'admin' && body.orgRole === 'member' && !body.grants?.length) throw noWebsites();
    if (body.grants) await validateOrganizationGrants(tx, organizationId, body.grants);
    if (member.orgRole === 'admin' && body.orgRole === 'member') await replaceGrants(tx, organizationId, member.userId, body.grants ?? [], actorId);
    const result = await tx.member.update({ where: { id }, data: { orgRole: body.orgRole, role: body.orgRole === 'member' ? 'viewer' : 'admin' } });
    await revokeJoinLinksBeyondRole(tx, organizationId, member.userId, body.orgRole);
    await syncLegacyMembership(tx, organizationId, member.userId);
    return { id: result.id, orgRole: result.orgRole };
  });
export const replaceOrganizationMemberAccess = (organizationId: string, actorId: string, id: string, grants: AdmissionGrant[]) =>
  withOrganization(organizationId, actorId, async (tx) => {
    await validateOrganizationGrants(tx, organizationId, grants);
    const member = await targetMember(tx, organizationId, id);
    if (member.orgRole !== 'member') throw forbidden('Organization admins have access via the organization.');
    if (!grants.length) throw noWebsites();
    await replaceGrants(tx, organizationId, member.userId, grants, actorId);
    await revokeJoinLinksBeyondRole(tx, organizationId, member.userId, 'member');
    await syncLegacyMembership(tx, organizationId, member.userId);
    return { id };
  });
export const removeOrganizationMember = (organizationId: string, actorId: string, id?: string) =>
  withOrganization(
    organizationId,
    actorId,
    async (tx, _org, actor) => {
      const member = await targetMember(tx, organizationId, id ?? actor.id);
      if (id && !isAdmin(actor.orgRole)) throw forbidden('Organization administrator access required.');
      await tx.member.delete({ where: { id: member.id } });
      await revokeJoinLinksBeyondRole(tx, organizationId, member.userId, null);
      return { id: member.id };
    },
    false,
  );
export const transferOrganizationOwnership = (organizationId: string, actorId: string, memberId: string) =>
  withOrganization(organizationId, actorId, async (tx, _org, actor) => {
    const members = await tx.member.findMany({ where: { organizationId }, select: { id: true, userId: true, orgRole: true } });
    const plan = planOwnershipTransfer(
      members.map((member) => ({ id: member.id, role: member.orgRole })),
      actor.id,
      memberId,
    );
    if (!plan.ok) {
      if (plan.reason === 'actor_not_owner') throw forbidden('Only the owner can transfer ownership.');
      if (plan.reason === 'target_not_found') throw notFound('member');
      throw conflict('Choose another organization admin.');
    }
    const member = members.find((member) => member.id === plan.promote);
    if (!member) throw notFound('member');
    await assertUsableAccount(member.userId, tx);
    await tx.member.update({ where: { id: actor.id }, data: { orgRole: 'admin', role: 'admin' } });
    await tx.member.update({ where: { id: member.id }, data: { orgRole: 'owner', role: 'owner' } });
    return { id: member.id };
  });

const linkSelect = {
  id: true,
  label: true,
  orgRole: true,
  allowedDomain: true,
  maxUses: true,
  useCount: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  createdById: true,
  createdBy: { select: userSelect },
  grants: { select: { projectId: true, role: true, project: { select: { name: true } } } },
  uses: {
    take: 20,
    orderBy: { createdAt: 'desc' as const },
    select: { id: true, email: true, role: true, createdAt: true, user: { select: userSelect } },
  },
} satisfies Prisma.JoinLinkSelect;
const presentLink = (link: Prisma.JoinLinkGetPayload<{ select: typeof linkSelect }>) => ({
  ...link,
  role: link.grants[0]?.role ?? 'viewer',
  status: joinLinkStatus(link),
});
export const listOrganizationJoinLinks = async (organizationId: string, projectId?: string) => {
  const links = await prisma.joinLink.findMany({
    where: { organizationId, ...(projectId ? { grants: { some: { projectId }, every: { projectId } } } : {}) },
    select: linkSelect,
    orderBy: { createdAt: 'desc' },
  });
  return Promise.all(
    links.map(async (link) => ({
      ...presentLink(link),
      status: (await issuerAuthorizes(prisma, organizationId, link.createdById, 'member', link.grants)) ? joinLinkStatus(link) : ('revoked' as const),
    })),
  );
};
export type OrganizationLinkBody = {
  orgRole?: 'member';
  grants: AdmissionGrant[];
  label?: string;
  allowedDomain?: string | null;
  maxUses?: number | null;
  expiresInDays?: number | null;
};
export const createOrganizationJoinLink = (organizationId: string, actorId: string, body: OrganizationLinkBody, siteProjectId?: string) =>
  withOrganization(
    organizationId,
    actorId,
    async (tx) => {
      await validateOrganizationGrants(tx, organizationId, body.grants);
      if (!body.grants.length || (siteProjectId && (body.grants.length !== 1 || body.grants[0]?.projectId !== siteProjectId)))
        throw forbidden('Choose at least one website.');
      if (!(await issuerAuthorizes(tx, organizationId, actorId, 'member', body.grants))) throw forbidden('You cannot grant this access.');
      const token = generateJoinLinkToken();
      const link = await tx.joinLink.create({
        data: {
          organizationId,
          createdById: actorId,
          orgRole: 'member',
          role: 'viewer',
          tokenHash: hashJoinLinkToken(token),
          label: body.label || null,
          allowedDomain: body.allowedDomain ?? null,
          maxUses: body.maxUses ?? null,
          expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
          grants: { create: body.grants.map(({ projectId, role }) => ({ projectId, role })) },
        },
        select: linkSelect,
      });
      return { link: presentLink(link), token, url: `${env.APP_URL}${joinLinkPath(token)}` };
    },
    !siteProjectId,
  );
type PresentedLink = ReturnType<typeof presentLink>;
export function changeOrganizationJoinLink(
  organizationId: string,
  actorId: string,
  id: string,
  regenerate: true,
  siteProjectId?: string,
): Promise<{ link: PresentedLink; token: string; url: string }>;
export function changeOrganizationJoinLink(
  organizationId: string,
  actorId: string,
  id: string,
  regenerate: false,
  siteProjectId?: string,
): Promise<{ link: PresentedLink }>;
export function changeOrganizationJoinLink(organizationId: string, actorId: string, id: string, regenerate: boolean, siteProjectId?: string) {
  return withOrganization(
    organizationId,
    actorId,
    async (tx, _org, actor) => {
      const link = await tx.joinLink.findFirst({ where: { id, organizationId }, include: { grants: true } });
      if (!link || (siteProjectId && (link.grants.length !== 1 || link.grants[0]?.projectId !== siteProjectId))) throw notFound('join_link');
      if (!isAdmin(actor.orgRole) && !(await issuerAuthorizes(tx, organizationId, actorId, 'member', link.grants)))
        throw forbidden('You cannot manage this access.');
      if (regenerate && link.revokedAt) throw conflict('This link was disabled. Create a new link instead.');
      const token = regenerate ? generateJoinLinkToken() : null;
      const updated = await tx.joinLink.update({
        where: { id },
        data: token ? { tokenHash: hashJoinLinkToken(token) } : { revokedAt: link.revokedAt ?? new Date() },
        select: linkSelect,
      });
      return { link: presentLink(updated), ...(token ? { token, url: `${env.APP_URL}${joinLinkPath(token)}` } : {}) };
    },
    !siteProjectId,
  );
}
