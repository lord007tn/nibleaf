import { type AdmissionGrant, issuerAuthorizes } from '@nibleaf/auth/join-links';
import { type Prisma, prisma } from '@nibleaf/database';
import { logger } from '@nibleaf/logger';
import { hashJoinLinkToken } from '@nibleaf/shared/crypto';
import { emailInDomain, isJoinLinkToken } from '@nibleaf/shared/join-links';
import { rankOf } from '@nibleaf/shared/rbac';
import { AppError, conflict, forbidden, notFound } from '@/errors';
import { accessibleProjectIds, assertUsableAccount } from '@/lib/access';

export type AdmissionResult = { organizationId: string; landing: { projectId: string } | { organization: string } };
export const invalidJoinLink = () => new AppError({ code: 'join:invalid', message: 'This join link is not valid.' });
const invalidInvitation = () => notFound('invitation');

/** Lock the org row for the transaction. A fenced org (deletion started) or
 *  one needing repair refuses every change, except `resumeDeletion`, which
 *  only the deletion itself passes so an interrupted deletion can finish. */
export async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string, bootstrap = false, resumeDeletion = false) {
  await tx.$queryRaw`SELECT id FROM organization WHERE id = ${organizationId} FOR NO KEY UPDATE`;
  const org = await tx.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw notFound('organization');
  if ((org.deletionStartedAt && !resumeDeletion) || (org.needsRepair && !bootstrap)) throw conflict('This organization cannot be changed right now.');
  return org;
}

/** Adds only permissions; admins retain dormant grants and are never demoted. */
export async function applyAdmission(
  tx: Prisma.TransactionClient,
  organizationId: string,
  userId: string,
  orgRole: string,
  grants: AdmissionGrant[],
  createdById: string,
) {
  const current = await tx.member.findUnique({ where: { organizationId_userId: { organizationId, userId } }, include: { projectGrants: true } });
  const nextRole = !current || orgRole === 'owner' || (orgRole === 'admin' && current.orgRole === 'member') ? orgRole : current.orgRole;
  let changed = !current || current.orgRole !== nextRole;
  if (!current) await tx.member.create({ data: { organizationId, userId, orgRole: nextRole, role: nextRole === 'member' ? 'viewer' : nextRole } });
  else if (current.orgRole !== nextRole)
    await tx.member.update({ where: { id: current.id }, data: { orgRole: nextRole, role: nextRole === 'member' ? 'viewer' : nextRole } });
  for (const grant of grants) {
    const existing = current?.projectGrants.find((g) => g.projectId === grant.projectId);
    if (existing && rankOf(existing.role) >= rankOf(grant.role)) continue;
    await tx.projectMember.upsert({
      where: { projectId_userId: { projectId: grant.projectId, userId } },
      create: { organizationId, userId, projectId: grant.projectId, role: grant.role, createdById },
      update: { role: grant.role },
    });
    changed = true;
  }
  return { changed, newMembership: !current };
}

export const admit = async (userId: string, source: { invitationId: string } | { token: string }): Promise<AdmissionResult> => {
  const invitation = 'invitationId' in source;
  if (!invitation && !isJoinLinkToken(source.token)) throw invalidJoinLink();
  const tokenHash = !invitation ? hashJoinLinkToken(source.token) : null;
  const initial = invitation
    ? await prisma.invitation.findUnique({ where: { id: source.invitationId } })
    : await prisma.joinLink.findUnique({ where: { tokenHash: tokenHash ?? '' } });
  if (!initial) throw invitation ? invalidInvitation() : invalidJoinLink();
  const committed = await prisma.$transaction(async (tx) => {
    const bootstrap = invitation && 'kind' in initial && initial.kind === 'bootstrap_owner';
    const org = await lockOrganization(tx, initial.organizationId, bootstrap);
    const invite = invitation
      ? await tx.invitation.findFirst({ where: { id: initial.id, organizationId: org.id }, include: { grants: true } })
      : null;
    const link = !invitation
      ? await tx.joinLink.findFirst({ where: { id: initial.id, organizationId: org.id, tokenHash: tokenHash ?? '' }, include: { grants: true } })
      : null;
    const invalid = invitation ? invalidInvitation : invalidJoinLink;
    if (invite && (!['member', 'bootstrap_owner'].includes(invite.kind) || (invite.kind === 'bootstrap_owner') !== bootstrap)) throw invalid();
    const issuerId = invite?.inviterId ?? link?.createdById;
    if (!issuerId) throw invalid();
    // Org -> issuer account -> issuer membership -> accepting account. Account
    // locks conflict with suspension/deletion; the org lock serializes grants.
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${issuerId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM member WHERE "organizationId" = ${org.id} AND "userId" = ${issuerId} FOR SHARE`;
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR SHARE`;
    try {
      await assertUsableAccount(issuerId, tx);
    } catch (error) {
      if (error instanceof AppError && error.code === 'auth:invalid_session') throw invalid();
      throw error;
    }
    await assertUsableAccount(userId, tx);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerified: true, name: true } });
    if (!user.emailVerified) throw new AppError({ code: 'join:email_unverified', message: 'Verify your email address before joining.' });
    const grants = invite?.grants ?? link?.grants ?? [];
    if (invite) {
      if (invite.status !== 'pending' || invite.expiresAt <= new Date()) throw invalid();
      if (invite.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) throw forbidden('This invitation is for another email address.');
      if (bootstrap) {
        // kind=bootstrap_owner is issued only by the platform-admin creation path.
        if (invite.orgRole !== 'owner' || grants.length || (await tx.member.count({ where: { organizationId: org.id, orgRole: 'owner' } })))
          throw invalid();
      } else if (!(await issuerAuthorizes(tx, org.id, issuerId, invite.orgRole, grants))) throw invalid();
      const claimed = await tx.invitation.updateMany({
        where: { id: invite.id, organizationId: org.id, status: 'pending', expiresAt: { gt: new Date() } },
        data: { status: 'accepted' },
      });
      if (claimed.count !== 1) throw invalid();
    } else {
      if (
        link?.orgRole !== 'member' ||
        !grants.length ||
        link.revokedAt ||
        (link.expiresAt && link.expiresAt <= new Date()) ||
        !(await issuerAuthorizes(tx, org.id, issuerId, 'member', grants))
      )
        throw invalid();
      if (!emailInDomain(user.email, link.allowedDomain))
        throw new AppError({
          code: 'join:domain_not_allowed',
          message: `Only @${link.allowedDomain} addresses can join with this link.`,
          details: { domain: link.allowedDomain },
        });
    }
    const transition = await applyAdmission(tx, org.id, userId, bootstrap ? 'owner' : (invite?.orgRole ?? 'member'), grants, issuerId);
    if (link) {
      if (transition.changed) {
        const taken = await tx.joinLink.updateMany({
          where: {
            id: link.id,
            tokenHash: tokenHash ?? '',
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            AND: [{ OR: [{ maxUses: null }, { useCount: { lt: tx.joinLink.fields.maxUses } }] }],
          },
          data: { useCount: { increment: 1 } },
        });
        if (taken.count !== 1) throw invalidJoinLink();
        await tx.joinLinkUse.create({ data: { joinLinkId: link.id, userId, email: user.email, role: grants[0]?.role ?? 'viewer' } });
      }
      await tx.joinLinkRedemption.upsert({
        where: { joinLinkId_userId: { joinLinkId: link.id, userId } },
        create: { joinLinkId: link.id, userId },
        update: {},
      });
    }
    if (bootstrap && org.needsRepair) await tx.organization.update({ where: { id: org.id }, data: { needsRepair: false } });
    const member = await tx.member.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: org.id, userId } } });
    const sites = await tx.project.findMany({
      where: { organizationId: org.id, ...(member.orgRole === 'member' ? { members: { some: { userId } } } : {}) },
      select: { id: true },
      take: 2,
    });
    await tx.userPreference.upsert({ where: { userId }, create: { userId, lastOrganizationId: org.id }, update: { lastOrganizationId: org.id } });
    const result: AdmissionResult = {
      organizationId: org.id,
      landing: sites.length === 1 && sites[0] ? { projectId: sites[0].id } : { organization: org.slug },
    };
    return { result, organization: org, user, newMembership: transition.newMembership };
  });
  // Notification delivery is best-effort after the admission commits. A repeat
  // never emits another join, and current website visibility is re-read.
  if (committed.newMembership) {
    try {
      const { notifyMemberJoined } = await import('@nibleaf/auth/server');
      for (const projectId of await accessibleProjectIds(userId, committed.result.organizationId)) {
        await notifyMemberJoined({ projectId, organization: committed.organization, userId, user: committed.user });
      }
    } catch {
      logger.warn({ organizationId: committed.result.organizationId }, 'admission notification delivery failed');
    }
  }
  return committed.result;
};
