import { notifyMemberJoined } from '@nibleaf/auth/server';
import { Prisma, prisma } from '@nibleaf/database';
import { generateJoinLinkToken, hashJoinLinkToken } from '@nibleaf/shared/crypto';
import { emailInDomain, isJoinLinkToken, joinLinkPath, joinLinkStatus } from '@nibleaf/shared/join-links';
import { canAssignRole } from '@nibleaf/shared/rbac';
import type { CreateJoinLinkBody } from '@nibleaf/validators';
import { env } from '@/env';
import { AppError, conflict, forbidden, notFound } from '@/errors';
import { logPlatformEvent } from './platform-events';

type Actor = { id: string; role: string };

const DAY_MS = 24 * 60 * 60 * 1000;
/** Most recent joins returned with each link in the admin list. */
const RECENT_USES = 20;

const linkSelect = {
  id: true,
  label: true,
  role: true,
  allowedDomain: true,
  maxUses: true,
  useCount: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  createdBy: { select: { id: true, name: true, email: true } },
  uses: {
    orderBy: { createdAt: 'desc' },
    take: RECENT_USES,
    select: { id: true, email: true, role: true, createdAt: true, user: { select: { id: true, name: true, email: true } } },
  },
} satisfies Prisma.JoinLinkSelect;

type LinkRow = Prisma.JoinLinkGetPayload<{ select: typeof linkSelect }>;

/** A link as admins see it. Never includes the token or its hash. */
const present = (link: LinkRow) => ({ ...link, status: joinLinkStatus(link) });

const absoluteUrl = (token: string) => `${env.APP_URL}${joinLinkPath(token)}`;

/** The one answer for a bad, revoked, expired or used-up token, so a caller
 *  can never tell which (and can't probe for live tokens). */
const invalidLink = () => new AppError({ code: 'join:invalid', message: 'This join link is not valid.' });

export const listJoinLinks = async (organizationId: string) =>
  (await prisma.joinLink.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, select: linkSelect })).map(present);

/**
 * Create a join link for a site. The granted role is never owner (schema) and
 * never above the creator's own role. The token is returned ONCE: only its
 * SHA-256 is stored, so the admin copies it now or regenerates later.
 */
export const createJoinLink = async (organizationId: string, actor: Actor, body: CreateJoinLinkBody) => {
  if (!canAssignRole(actor.role, body.role)) {
    throw forbidden('You cannot create a link that grants a role higher than your own.', { role: body.role });
  }
  const token = generateJoinLinkToken();
  const link = await prisma.joinLink.create({
    data: {
      organizationId,
      tokenHash: hashJoinLinkToken(token),
      label: body.label || null,
      role: body.role,
      allowedDomain: body.allowedDomain ?? null,
      maxUses: body.maxUses ?? null,
      expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * DAY_MS) : null,
      createdById: actor.id,
    },
    select: linkSelect,
  });
  logPlatformEvent('join_link_created', { userId: actor.id, metadata: { organizationId, joinLinkId: link.id, role: link.role } });
  return { link: present(link), token, url: absoluteUrl(token) };
};

const findLink = async (organizationId: string, id: string) => {
  const link = await prisma.joinLink.findFirst({ where: { id, organizationId }, select: { id: true, role: true, revokedAt: true } });
  if (!link) throw notFound('join_link', { id });
  return link;
};

/** Stop a link from working. Idempotent; people who already joined stay. */
export const revokeJoinLink = async (organizationId: string, id: string, actor: Actor) => {
  const existing = await findLink(organizationId, id);
  const link = existing.revokedAt
    ? await prisma.joinLink.findUniqueOrThrow({ where: { id }, select: linkSelect })
    : await prisma.joinLink.update({ where: { id }, data: { revokedAt: new Date() }, select: linkSelect });
  if (!existing.revokedAt) logPlatformEvent('join_link_revoked', { userId: actor.id, metadata: { organizationId, joinLinkId: id } });
  return present(link);
};

/**
 * Replace a link's token, keeping its settings and history. The old URL stops
 * working at once. A revoked link stays revoked: create a new one instead, so
 * "disable" is always final.
 */
export const regenerateJoinLink = async (organizationId: string, id: string, actor: Actor) => {
  const existing = await findLink(organizationId, id);
  if (existing.revokedAt) throw conflict('This link was disabled. Create a new link instead.');
  if (!canAssignRole(actor.role, existing.role)) throw forbidden('You cannot manage a link that grants a role higher than your own.');
  const token = generateJoinLinkToken();
  const link = await prisma.joinLink.update({ where: { id }, data: { tokenHash: hashJoinLinkToken(token) }, select: linkSelect });
  logPlatformEvent('join_link_regenerated', { userId: actor.id, metadata: { organizationId, joinLinkId: id } });
  return { link: present(link), token, url: absoluteUrl(token) };
};

const usableLinkByToken = async (token: string) => {
  if (!isJoinLinkToken(token)) return null;
  const link = await prisma.joinLink.findUnique({
    where: { tokenHash: hashJoinLinkToken(token) },
    select: {
      id: true,
      organizationId: true,
      role: true,
      allowedDomain: true,
      maxUses: true,
      useCount: true,
      expiresAt: true,
      revokedAt: true,
      organization: { select: { id: true, name: true, metadata: true, projects: { select: { id: true, name: true }, take: 1 } } },
    },
  });
  return link && joinLinkStatus(link) === 'active' ? link : null;
};

/** What the public /join page shows before anyone signs in: the site, the
 *  role and any domain rule. Unknown and unusable tokens get one answer. */
export const getJoinLinkPreview = async (token: string) => {
  const link = await usableLinkByToken(token);
  const site = link?.organization.projects[0];
  if (!(link && site)) throw invalidLink();
  return { siteName: site.name, role: link.role, allowedDomain: link.allowedDomain };
};

export type JoinResult = { status: 'joined' | 'already_member'; projectId: string; role: string };

/**
 * Join a site through a link, as the signed-in user.
 * - The address must be verified, and inside the link's domain when it has one.
 * - Someone already on the team gets "already a member" (with their own role),
 *   which never consumes a use.
 * - A use is taken atomically: one UPDATE that only matches while the link is
 *   active and `useCount < maxUses`. Concurrent joins can never exceed the cap,
 *   and the membership is created in the same transaction, so a failed insert
 *   gives the use back.
 */
export const joinWithLink = async (token: string, userId: string): Promise<JoinResult> => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, name: true, emailVerified: true } });
  if (!user) throw new AppError({ code: 'auth:no_user' });
  const link = await usableLinkByToken(token);
  const site = link?.organization.projects[0];
  if (!(link && site)) throw invalidLink();

  const existing = await prisma.member.findUnique({
    where: { organizationId_userId: { organizationId: link.organizationId, userId } },
    select: { role: true },
  });
  if (existing) return { status: 'already_member', projectId: site.id, role: existing.role };

  if (!user.emailVerified) {
    throw new AppError({ code: 'join:email_unverified', message: 'Verify your email address before joining.' });
  }
  if (!emailInDomain(user.email, link.allowedDomain)) {
    throw new AppError({
      code: 'join:domain_not_allowed',
      message: `Only @${link.allowedDomain} addresses can join with this link.`,
      details: { domain: link.allowedDomain },
    });
  }

  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const taken = await tx.joinLink.updateMany({
        where: {
          id: link.id,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          AND: [{ OR: [{ maxUses: null }, { useCount: { lt: tx.joinLink.fields.maxUses } }] }],
        },
        data: { useCount: { increment: 1 } },
      });
      if (taken.count !== 1) throw invalidLink();
      await tx.member.create({ data: { organizationId: link.organizationId, userId, role: link.role } });
      await tx.joinLinkUse.create({ data: { joinLinkId: link.id, userId, email: user.email, role: link.role } });
    });
  } catch (error) {
    // Joined in parallel (another tab, a double click): the unique member row
    // already exists and this attempt's use was rolled back with it.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const member = await prisma.member.findUnique({
        where: { organizationId_userId: { organizationId: link.organizationId, userId } },
        select: { role: true },
      });
      if (member) return { status: 'already_member', projectId: site.id, role: member.role };
    }
    throw error;
  }

  logPlatformEvent('join_link_used', { userId, projectId: site.id, metadata: { joinLinkId: link.id, role: link.role } });
  await notifyMemberJoined({ organization: link.organization, userId, user });
  return { status: 'joined', projectId: site.id, role: link.role };
};
