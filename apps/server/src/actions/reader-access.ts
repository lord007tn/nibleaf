import { createHash, randomBytes } from 'node:crypto';
import { auth } from '@nibleaf/auth/server';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { Prisma, prisma } from '@nibleaf/database';
import { type EmailLanguage, renderReaderInvitationEmail } from '@nibleaf/email';
import type {
  CreateAudienceBody,
  InviteReaderBody,
  InviteReadersBody,
  JwtAccessConfigBody,
  ProjectAccessModeBody,
  ReaderEmailDomainsBody,
  UpdateAudienceBody,
  UpdateReaderBody,
} from '@nibleaf/validators';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { env } from '@/env';
import { badRequest, conflict, notFound } from '@/errors';
import { optionalSiteAccess } from '@/lib/access';
import type { HonoEnv } from '@/lib/hono/context';
import { assertPublicJwksUrl, claimAt, claimStrings, isJwtVerificationError, jwtReplayHash, verifyReaderJwt } from '@/lib/reader-jwt';

/**
 * Lock order. Every transaction that grants or revokes reader access takes row
 * locks in this order, so no two of them can deadlock:
 *
 *   JWT provider → reader → invitations → sessions
 *
 * - JWT exchange: provider (shared, enabled = true) → reader → new session.
 * - Invitation activation: reader → invitation → new session.
 * - Reader revocation: reader → invitations → sessions.
 * - Emergency revocation: provider (committed on its own) → invitations →
 *   sessions.
 *
 * Within one table, a revocation that updates several rows first locks them
 * with `ORDER BY "id" FOR UPDATE`, so two revocations over overlapping rows
 * acquire them in the same order. A revocation that still loses a deadlock or
 * write conflict is retried once.
 *
 * A grant writes conditionally on current state, and a revocation writes the
 * row a grant locks before it revokes sessions. Whichever commits first, the
 * revocation wins: either the grant's conditional write matches nothing, or the
 * revocation waits for the grant to commit and then revokes the new session.
 */
const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const newSecret = (): string => randomBytes(32).toString('base64url');
/** The stored identity of a JWT reader: its issuer and subject, kept apart so a
 *  subject that contains the issuer text can't collide with another reader.
 *  JSON keeps the pair unambiguous and is valid PostgreSQL text, which can't
 *  contain a NUL byte. */
export const jwtReaderIdentity = (issuer: string, subject: string): string => JSON.stringify([issuer, subject]);

/** The site session cookie. Readers and team members signed in on the site share it. */
const cookieName = (projectId: string): string => `nibleaf_reader_${projectId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
export const requestFingerprint = (ctx: Context<HonoEnv>) => ({
  ipHash: ctx.req.header('x-forwarded-for') ? sha256(ctx.req.header('x-forwarded-for') as string) : null,
  userAgentHash: ctx.req.header('user-agent') ? sha256(ctx.req.header('user-agent') as string) : null,
});

export const logAudit = (data: {
  projectId: string;
  action: string;
  readerId?: string | null;
  actorUserId?: string | null;
  metadata?: Record<string, unknown>;
  ipHash?: string | null;
}) =>
  prisma.readerAuditLog
    .create({
      data: {
        projectId: data.projectId,
        action: data.action,
        readerId: data.readerId ?? null,
        actorUserId: data.actorUserId ?? null,
        metadata: data.metadata ? (data.metadata as Prisma.InputJsonValue) : undefined,
        ipHash: data.ipHash ?? null,
      },
    })
    .catch(() => undefined);

const assertAudiences = async (projectId: string, audienceIds: string[]): Promise<void> => {
  const unique = [...new Set(audienceIds)];
  const count = await prisma.audience.count({ where: { projectId, id: { in: unique } } });
  if (count !== unique.length) throw badRequest('One or more audiences do not belong to this site.');
};

const pageGrants = async (projectId: string, pageIds: string[]) => {
  const unique = [...new Set(pageIds)];
  if (unique.length === 0) return [{ projectId, pageId: null as string | null, scopeKey: 'SITE' }];
  const count = await prisma.page.count({ where: { projectId, id: { in: unique } } });
  if (count !== unique.length) throw badRequest('One or more pages do not belong to this site.');
  return unique.map((pageId) => ({ projectId, pageId, scopeKey: `PAGE:${pageId}` }));
};

export interface ViewerAccess {
  kind: 'public' | 'workspace' | 'reader';
  readerId?: string;
  /** null means every page; a Set means only those snapshot page ids. */
  allowedPageIds: Set<string> | null;
  /** Signed in on the site itself (its own cookie), so the site can offer Sign out. */
  siteSession?: boolean;
}

/** How long a site session may go unused before its last-seen time is refreshed. */
const SESSION_TOUCH_MS = 5 * 60_000;

/** A team member signed in on the site with an email code, while they are still a member. */
const siteMemberViewer = async (projectId: string, tokenHash: string): Promise<ViewerAccess | null> => {
  const session = await prisma.siteMemberSession.findFirst({
    where: { projectId, tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    select: {
      id: true,
      userId: true,
      lastUsedAt: true,
      project: { select: { organizationId: true } },
      user: { select: { banned: true, suspendedAt: true } },
    },
  });
  // A suspended account loses site access with its existing sessions too.
  if (!session || session.user.banned || session.user.suspendedAt) return null;
  if (!(await optionalSiteAccess(session.userId, projectId))) return null;
  if (Date.now() - session.lastUsedAt.getTime() > SESSION_TOUCH_MS) {
    void prisma.siteMemberSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  }
  return { kind: 'workspace', allowedPageIds: null, siteSession: true };
};

/** Whether the request carries a dashboard session of a member of this site. */
export const isSiteMemberRequest = async (projectId: string, headers: Headers): Promise<boolean> => {
  const result = await auth.api.getSession({ headers }).catch(() => null);
  if (!result?.user?.id) return false;
  return Boolean(await optionalSiteAccess(result.user.id, projectId));
};

/** Central authorization boundary shared by pages, search, machine-readable
 * documents, changelog, assets, and metadata. A workspace member always retains
 * emergency/preview access to their own site. */
export const resolveViewerAccess = async (
  projectId: string,
  accessMode: 'PUBLIC' | 'WORKSPACE' | 'READERS',
  headers: Headers,
): Promise<ViewerAccess | null> => {
  if (accessMode === 'PUBLIC') return { kind: 'public', allowedPageIds: null };
  const rawCookie = headers.get('cookie') ?? '';
  const hasSiteCookie = new RegExp(`(?:^|;\\s*)${cookieName(projectId)}=`).test(rawCookie);
  // A dashboard member who also signed in on the site can still sign out of it there.
  if (await isSiteMemberRequest(projectId, headers))
    return { kind: 'workspace', allowedPageIds: null, ...(hasSiteCookie ? { siteSession: true } : {}) };

  const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${cookieName(projectId)}=([^;]+)`));
  let token: string | null = null;
  try {
    token = match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
  if (!token) return null;
  const tokenHash = sha256(token);
  // A team member signed in on the site itself (a custom domain never sees the
  // dashboard session) reads in both private modes; readers only in READERS.
  const member = await siteMemberViewer(projectId, tokenHash);
  if (member) return member;
  if (accessMode === 'WORKSPACE') return null;

  const session = await prisma.readerSession.findFirst({
    where: { projectId, tokenHash, revokedAt: null, expiresAt: { gt: new Date() }, reader: { revokedAt: null, status: 'ACTIVE' } },
    select: {
      id: true,
      readerId: true,
      lastUsedAt: true,
      reader: { select: { audiences: { select: { audience: { select: { grants: { select: { pageId: true } } } } } } } },
    },
  });
  if (!session) return null;
  const grants = session.reader.audiences.flatMap((membership) => membership.audience.grants);
  if (Date.now() - session.lastUsedAt.getTime() > SESSION_TOUCH_MS) {
    void Promise.all([
      prisma.readerSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }),
      prisma.reader.update({ where: { id: session.readerId }, data: { lastSeenAt: new Date() } }),
    ]).catch(() => undefined);
  }
  return {
    kind: 'reader',
    readerId: session.readerId,
    siteSession: true,
    allowedPageIds: grants.some((grant) => grant.pageId === null) ? null : new Set(grants.flatMap((grant) => (grant.pageId ? [grant.pageId] : []))),
  };
};

export const setSessionCookie = (ctx: Context<HonoEnv>, projectId: string, token: string, expiresAt: Date): void => {
  setCookie(ctx, cookieName(projectId), token, {
    httpOnly: true,
    secure: env.APP_URL.startsWith('https://'),
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
  ctx.header('Cache-Control', 'private, no-store');
};

export const listReaderAccess = async (projectId: string) => {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { accessMode: true, readerEmailDomains: true, readerAccessRequests: true },
  });
  if (!project) throw notFound('project', { id: projectId });
  const [readers, audiences, jwt, audit, accessRequests] = await Promise.all([
    prisma.reader.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        status: true,
        activatedAt: true,
        revokedAt: true,
        lastSeenAt: true,
        createdAt: true,
        audiences: { select: { audience: { select: { id: true, name: true } } } },
        _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: new Date() } } } } },
      },
    }),
    prisma.audience.findMany({
      where: { projectId },
      orderBy: { name: 'asc' },
      include: { grants: { select: { pageId: true } }, _count: { select: { readers: true } } },
    }),
    prisma.jwtAccessProvider.findUnique({ where: { projectId } }),
    prisma.readerAuditLog.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.readerAccessRequest.findMany({
      where: { projectId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, email: true, name: true, note: true, createdAt: true },
    }),
  ]);
  return {
    accessMode: project.accessMode,
    readerEmailDomains: project.readerEmailDomains,
    readerAccessRequests: project.readerAccessRequests,
    accessRequests,
    readers,
    audiences,
    jwt,
    audit,
  };
};

export const setProjectAccessMode = async (projectId: string, actorUserId: string, body: ProjectAccessModeBody) => {
  const project = await prisma.project.update({ where: { id: projectId }, data: { accessMode: body.mode }, select: { accessMode: true } });
  const deployment = await prisma.deployment.findFirst({
    where: { projectId, status: 'READY' },
    orderBy: { version: 'desc' },
    select: { id: true },
  });
  if (deployment) {
    // Search payload visibility is server-derived. Re-upsert the immutable
    // deployment after an access-mode change so the hybrid index converges to
    // the new gate; until it does, a visibility mismatch fails closed.
    await createJob(
      QueueNames.SEARCH,
      { name: 'index-deployment', data: { projectId, deploymentId: deployment.id } },
      { jobId: `search-access-${projectId}-${deployment.id}-${body.mode.toLowerCase()}` },
    ).catch(() => undefined);
  }
  await logAudit({ projectId, actorUserId, action: 'ACCESS_MODE_CHANGED', metadata: { mode: body.mode } });
  return project;
};

export const createAudience = async (projectId: string, actorUserId: string, body: CreateAudienceBody) => {
  const grants = await pageGrants(projectId, body.pageIds ?? []);
  const audience = await prisma.audience.create({
    data: { projectId, name: body.name, description: body.description, grants: { create: grants } },
    include: { grants: true },
  });
  await logAudit({ projectId, actorUserId, action: 'AUDIENCE_CREATED', metadata: { audienceId: audience.id } });
  return audience;
};

export const updateAudience = async (projectId: string, audienceId: string, actorUserId: string, body: UpdateAudienceBody) => {
  const existing = await prisma.audience.findFirst({ where: { id: audienceId, projectId } });
  if (!existing) throw notFound('audience', { id: audienceId });
  const grants = body.pageIds ? await pageGrants(projectId, body.pageIds) : null;
  const audience = await prisma.$transaction(async (tx) => {
    if (grants) {
      await tx.audienceGrant.deleteMany({ where: { audienceId, projectId } });
    }
    return tx.audience.update({
      where: { id: audienceId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(grants ? { grants: { create: grants } } : {}),
      },
      include: { grants: true },
    });
  });
  await logAudit({ projectId, actorUserId, action: 'AUDIENCE_UPDATED', metadata: { audienceId } });
  return audience;
};

export const deleteAudience = async (projectId: string, audienceId: string, actorUserId: string) => {
  const result = await prisma.audience.deleteMany({ where: { id: audienceId, projectId } });
  if (!result.count) throw notFound('audience', { id: audienceId });
  await logAudit({ projectId, actorUserId, action: 'AUDIENCE_DELETED', metadata: { audienceId } });
  return { id: audienceId };
};

/** The audience that grants the whole site, created the first time a reader is
 *  invited without choosing pages. Owners never need to set up audiences first. */
export const ensureSiteAudience = async (projectId: string): Promise<string> => {
  const find = () =>
    prisma.audience.findFirst({
      where: { projectId, grants: { some: { scopeKey: 'SITE' } } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  const existing = await find();
  if (existing) return existing.id;
  for (const name of ['Everyone', 'Everyone (whole site)']) {
    try {
      const created = await prisma.audience.create({
        data: { projectId, name, grants: { create: [{ projectId, pageId: null, scopeKey: 'SITE' }] } },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if ((error as { code?: unknown }).code !== 'P2002') throw error;
      // Taken: by a concurrent invite creating the same audience, or by a page-scoped one.
      const raced = await find();
      if (raced) return raced.id;
    }
  }
  const fallback = await prisma.audience.create({
    data: { projectId, name: `Everyone ${randomBytes(3).toString('hex')}`, grants: { create: [{ projectId, pageId: null, scopeKey: 'SITE' }] } },
    select: { id: true },
  });
  return fallback.id;
};

/** Send a reader a fresh invitation link (earlier unused links stop working). */
const sendReaderInvitation = async (projectId: string, actorUserId: string, reader: { id: string; email: string }, language?: EmailLanguage) => {
  await prisma.readerInvitation.updateMany({ where: { readerId: reader.id, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  const token = newSecret();
  const invitation = await prisma.readerInvitation.create({
    data: { projectId, readerId: reader.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS), createdById: actorUserId },
  });
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { name: true, domains: { where: { verified: true, isPrimary: true }, take: 1, select: { domain: true } } },
  });
  // Set the reader cookie on the same host that will serve the docs. Host-only
  // cookies intentionally never span unrelated customer domains.
  const readerOrigin = project?.domains[0]?.domain ? `https://${project.domains[0].domain}` : env.APP_URL;
  const activationUrl = `${readerOrigin}/api/public/reader-access/activate?token=${encodeURIComponent(token)}`;
  const message = await renderReaderInvitationEmail({
    activationUrl,
    days: 7,
    projectName: project?.name ?? 'private documentation',
    language,
  });
  await createJob(QueueNames.EMAIL, { name: 'send-email', data: { to: reader.email, ...message } }).catch(() => undefined);
  await logAudit({ projectId, readerId: reader.id, actorUserId, action: 'READER_INVITED' });
  return { invitation: { id: invitation.id, expiresAt: invitation.expiresAt }, activationUrl };
};

export const inviteReader = async (projectId: string, actorUserId: string, body: InviteReaderBody, language?: EmailLanguage) => {
  const audienceIds = body.audienceIds?.length ? [...new Set(body.audienceIds)] : [await ensureSiteAudience(projectId)];
  await assertAudiences(projectId, audienceIds);
  const reader = await prisma.reader.upsert({
    where: { projectId_email: { projectId, email: body.email } },
    create: {
      projectId,
      email: body.email,
      name: body.name,
      audiences: { create: audienceIds.map((audienceId) => ({ audienceId })) },
    },
    update: {
      name: body.name,
      status: 'INVITED',
      revokedAt: null,
      audiences: { deleteMany: {}, create: audienceIds.map((audienceId) => ({ audienceId })) },
    },
  });
  const sent = await sendReaderInvitation(projectId, actorUserId, { id: reader.id, email: body.email }, language);
  return { reader, ...sent };
};

/** Invite several readers at once (the dashboard's comma/newline-separated field). */
export const inviteReaders = async (projectId: string, actorUserId: string, body: InviteReadersBody, language?: EmailLanguage) => {
  const audienceIds = body.audienceIds?.length ? [...new Set(body.audienceIds)] : [await ensureSiteAudience(projectId)];
  await assertAudiences(projectId, audienceIds);
  const readers: Array<{ id: string; email: string | null }> = [];
  for (const email of [...new Set(body.emails)]) {
    const { reader } = await inviteReader(projectId, actorUserId, { email, audienceIds }, language);
    readers.push({ id: reader.id, email: reader.email });
  }
  return { invited: readers.length, readers };
};

/** Email an invited or active reader a new invitation link, keeping their access as it is. */
export const resendReaderInvitation = async (projectId: string, readerId: string, actorUserId: string, language?: EmailLanguage) => {
  const reader = await prisma.reader.findFirst({ where: { id: readerId, projectId }, select: { id: true, email: true, revokedAt: true } });
  if (!reader) throw notFound('reader', { id: readerId });
  if (reader.revokedAt) throw badRequest('This reader was revoked. Invite them again to restore access.', { reason: 'reader_revoked' });
  if (!reader.email)
    throw badRequest('This reader signs in through your portal and has no email address to invite.', { reason: 'reader_without_email' });
  return sendReaderInvitation(projectId, actorUserId, { id: reader.id, email: reader.email }, language);
};

/** Email domains whose addresses can sign in to an Invited readers site without an invitation. */
export const setReaderEmailDomains = async (projectId: string, actorUserId: string, body: ReaderEmailDomainsBody) => {
  const domains = [...new Set(body.domains)].sort();
  const project = await prisma.project.update({
    where: { id: projectId },
    data: { readerEmailDomains: domains },
    select: { readerEmailDomains: true },
  });
  await logAudit({ projectId, actorUserId, action: 'EMAIL_DOMAINS_UPDATED', metadata: { domains } });
  return { domains: project.readerEmailDomains };
};

export const updateReader = async (projectId: string, readerId: string, actorUserId: string, body: UpdateReaderBody) => {
  const existing = await prisma.reader.findFirst({ where: { id: readerId, projectId } });
  if (!existing) throw notFound('reader', { id: readerId });
  if (body.audienceIds) await assertAudiences(projectId, body.audienceIds);
  const reader = await prisma.reader.update({
    where: { id: readerId },
    data: {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.audienceIds ? { audiences: { deleteMany: {}, create: [...new Set(body.audienceIds)].map((audienceId) => ({ audienceId })) } } : {}),
    },
  });
  await logAudit({ projectId, readerId, actorUserId, action: 'READER_UPDATED' });
  return reader;
};

/**
 * A transaction PostgreSQL rolled back as a deadlock victim (40P01) or for a
 * serialization failure (40001). The pg driver adapter reports both as a
 * transaction write conflict, which Prisma raises as P2034.
 */
export const isRetryableConflict = (error: unknown): boolean => (error as { code?: unknown } | null)?.code === 'P2034';

/** Revocation sweeps can touch every session of a project: allow them time. */
const SWEEP_TRANSACTION = { timeout: 60_000, maxWait: 10_000 } as const;

/** Run a revocation transaction, retrying it once after a deadlock or write conflict. */
const withConflictRetry = async <T>(run: () => Promise<T>): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (!isRetryableConflict(error)) throw error;
    return run();
  }
};

export const revokeReader = async (projectId: string, readerId: string, actorUserId: string) => {
  const reader = await prisma.reader.findFirst({ where: { id: readerId, projectId } });
  if (!reader) throw notFound('reader', { id: readerId });
  // Lock order: reader → invitations → sessions, rows by id (see the top of
  // this file). The row locks return only a count, not the rows.
  await withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.reader.update({ where: { id: readerId }, data: { status: 'REVOKED', revokedAt: now } });
      await tx.$queryRaw`
        SELECT count(*)::int AS "locked" FROM (
          SELECT 1 FROM "reader_invitation"
          WHERE "projectId" = ${projectId} AND "readerId" = ${readerId} AND "acceptedAt" IS NULL AND "revokedAt" IS NULL
          ORDER BY "id" FOR UPDATE
        ) AS "locked_rows"`;
      await tx.readerInvitation.updateMany({ where: { projectId, readerId, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } });
      await tx.$queryRaw`
        SELECT count(*)::int AS "locked" FROM (
          SELECT 1 FROM "reader_session"
          WHERE "projectId" = ${projectId} AND "readerId" = ${readerId} AND "revokedAt" IS NULL
          ORDER BY "id" FOR UPDATE
        ) AS "locked_rows"`;
      await tx.readerSession.updateMany({ where: { projectId, readerId, revokedAt: null }, data: { revokedAt: now } });
    }, SWEEP_TRANSACTION),
  );
  await logAudit({ projectId, readerId, actorUserId, action: 'READER_REVOKED' });
  return { id: readerId };
};

export const emergencyRevoke = async (projectId: string, actorUserId: string) => {
  // Lock order: provider → invitations → sessions, rows by id (see the top of
  // this file). The JWT provider is disabled first, in its own statement, so
  // the switch stays off even if the sweep below fails. A JWT exchange holding
  // the provider row commits before the disable proceeds, and an activation
  // holding an invitation row commits before the invitation fence proceeds, so
  // every session they issued is visible to, and revoked by, the sweep.
  await withConflictRetry(() => prisma.jwtAccessProvider.updateMany({ where: { projectId }, data: { enabled: false } }));
  const { invitations, sessions } = await withConflictRetry(() =>
    prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.$queryRaw`
        SELECT count(*)::int AS "locked" FROM (
          SELECT 1 FROM "reader_invitation"
          WHERE "projectId" = ${projectId} AND "acceptedAt" IS NULL AND "revokedAt" IS NULL
          ORDER BY "id" FOR UPDATE
        ) AS "locked_rows"`;
      const fencedInvitations = await tx.readerInvitation.updateMany({
        where: { projectId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.$queryRaw`
        SELECT count(*)::int AS "locked" FROM (
          SELECT 1 FROM "reader_session" WHERE "projectId" = ${projectId} AND "revokedAt" IS NULL ORDER BY "id" FOR UPDATE
        ) AS "locked_rows"`;
      const revokedSessions = await tx.readerSession.updateMany({ where: { projectId, revokedAt: null }, data: { revokedAt: now } });
      return { invitations: fencedInvitations, sessions: revokedSessions };
    }, SWEEP_TRANSACTION),
  );
  await logAudit({ projectId, actorUserId, action: 'EMERGENCY_REVOKE', metadata: { sessions: sessions.count, invitations: invitations.count } });
  return { sessions: sessions.count, invitations: invitations.count, jwtDisabled: true };
};

export const configureJwtAccess = async (projectId: string, actorUserId: string, body: JwtAccessConfigBody) => {
  await assertAudiences(projectId, Object.values(body.claimMapping));
  if (body.jwksUrl) {
    await assertPublicJwksUrl(body.jwksUrl).catch(() => {
      throw badRequest('JWKS URL must resolve to a public HTTPS endpoint.');
    });
  }
  const jwt = await prisma.jwtAccessProvider.upsert({
    where: { projectId },
    create: {
      projectId,
      ...body,
      publicJwks: body.publicJwks ? (body.publicJwks as Prisma.InputJsonValue) : Prisma.JsonNull,
      jwksUrl: body.jwksUrl ?? null,
    },
    update: {
      ...body,
      publicJwks: body.publicJwks ? (body.publicJwks as Prisma.InputJsonValue) : Prisma.JsonNull,
      jwksUrl: body.jwksUrl ?? null,
    },
  });
  await logAudit({ projectId, actorUserId, action: 'JWT_CONFIGURATION_UPDATED', metadata: { enabled: body.enabled, issuer: body.issuer } });
  return jwt;
};

export const testJwtAccess = async (projectId: string, token: string) => {
  const configuration = await prisma.jwtAccessProvider.findUnique({ where: { projectId } });
  if (!configuration) throw notFound('JWT reader access');
  try {
    const payload = await verifyReaderJwt(token, configuration);
    const mapping = (configuration.claimMapping ?? {}) as Record<string, string>;
    const groups = claimStrings(claimAt(payload, configuration.groupsClaim));
    return {
      valid: true,
      subject: String(claimAt(payload, configuration.subjectClaim) ?? payload.sub ?? ''),
      groups,
      audienceIds: [...new Set(groups.flatMap((group) => (mapping[group] ? [mapping[group]] : [])))],
      expiresAt: new Date((payload.exp as number) * 1000),
    };
  } catch {
    throw badRequest('The JWT assertion is invalid or expired.');
  }
};

export const activateReaderInvitation = async (ctx: Context<HonoEnv>, token: string) => {
  const invitation = await prisma.readerInvitation.findUnique({
    where: { tokenHash: sha256(token) },
    include: { reader: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date() || invitation.reader.revokedAt) {
    throw notFound('reader invitation');
  }
  const now = new Date();
  const sessionToken = newSecret();
  const expiresAt = new Date(now.getTime() + DEFAULT_SESSION_TTL_MS);
  // Activation is one transaction whose every write is conditional on current
  // state, so a revocation always wins. Lock order: reader → invitation →
  // session (see the top of this file). A concurrent revocation either commits
  // first (the conditional update then matches nothing) or waits for this
  // commit and then revokes the session created here. Activation never clears
  // revokedAt.
  await prisma.$transaction(async (tx) => {
    const activated = await tx.reader.updateMany({
      where: { id: invitation.readerId, projectId: invitation.projectId, revokedAt: null },
      data: { status: 'ACTIVE', activatedAt: now },
    });
    if (activated.count !== 1) throw notFound('reader invitation');
    const accepted = await tx.readerInvitation.updateMany({
      where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      data: { acceptedAt: now },
    });
    if (accepted.count !== 1) throw conflict('This reader invitation has already been used.');
    await tx.readerSession.create({
      data: {
        projectId: invitation.projectId,
        readerId: invitation.readerId,
        tokenHash: sha256(sessionToken),
        source: 'INVITATION',
        expiresAt,
        ...requestFingerprint(ctx),
      },
    });
  });
  setSessionCookie(ctx, invitation.projectId, sessionToken, expiresAt);
  await logAudit({
    projectId: invitation.projectId,
    readerId: invitation.readerId,
    action: 'INVITATION_ACTIVATED',
    ipHash: requestFingerprint(ctx).ipHash,
  });
  return invitation.projectId;
};

export const jwtReaderHandoff = async (ctx: Context<HonoEnv>, projectId: string, token: string) => {
  const configuration = await prisma.jwtAccessProvider.findUnique({ where: { projectId } });
  if (!configuration?.enabled) throw notFound('JWT reader access');
  let payload: Awaited<ReturnType<typeof verifyReaderJwt>>;
  try {
    payload = await verifyReaderJwt(token, configuration);
  } catch (error) {
    await logAudit({
      projectId,
      action: 'JWT_REJECTED',
      metadata: { reason: isJwtVerificationError(error) ? 'verification' : 'invalid' },
      ipHash: requestFingerprint(ctx).ipHash,
    });
    throw badRequest('The JWT assertion is invalid or expired.');
  }
  const jti = payload.jti as string;
  try {
    await prisma.jwtReplay.create({
      data: { projectId, jtiHash: jwtReplayHash(configuration.issuer, jti), expiresAt: new Date((payload.exp as number) * 1000) },
    });
  } catch {
    throw conflict('This JWT assertion has already been used.');
  }
  void prisma.jwtReplay.deleteMany({ where: { expiresAt: { lt: new Date() } } }).catch(() => undefined);

  const mapping = (configuration.claimMapping ?? {}) as Record<string, string>;
  const groups = claimStrings(claimAt(payload, configuration.groupsClaim));
  const audienceIds = [...new Set(groups.flatMap((group) => (mapping[group] ? [mapping[group]] : [])))];
  if (audienceIds.length === 0) throw badRequest('The JWT claims do not map to an authorized audience.');
  await assertAudiences(projectId, audienceIds);
  const subject = String(claimAt(payload, configuration.subjectClaim) ?? payload.sub ?? '');
  if (!subject) throw badRequest('The JWT subject claim is missing.');
  const externalSubject = jwtReaderIdentity(configuration.issuer, subject);
  const rawEmail = claimAt(payload, configuration.emailClaim);
  const rawName = claimAt(payload, configuration.nameClaim);
  const email = typeof rawEmail === 'string' && rawEmail.includes('@') ? rawEmail.trim().toLowerCase().slice(0, 320) : null;
  const name = typeof rawName === 'string' ? rawName.trim().slice(0, 120) || null : null;
  // Merge an invited email identity with its first SSO handoff instead of
  // creating a duplicate. An explicit per-reader revocation is sticky: SSO
  // cannot silently reactivate that identity; an admin must re-invite it.
  const sessionToken = newSecret();
  const expiresAt = new Date(Date.now() + configuration.sessionTtlMinutes * 60_000);
  const fingerprint = requestFingerprint(ctx);
  // The exchange is one transaction. Lock order: provider → reader → session
  // (see the top of this file). It starts with a shared lock on the provider
  // row while it is still enabled, so an emergency revocation either commits
  // first (no enabled row: the exchange fails) or waits for this commit and
  // then revokes the session created here. The locked row must also be the
  // configuration the assertion was verified against: any change to it (keys,
  // claim mapping, issuer) fails the exchange.
  const readerId = await prisma.$transaction(async (tx) => {
    const [enabled] = await tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>`
      SELECT "id", "updatedAt" FROM "jwt_access_provider" WHERE "projectId" = ${projectId} AND "enabled" = true FOR SHARE`;
    if (!enabled) throw notFound('JWT reader access');
    if (enabled.id !== configuration.id || new Date(enabled.updatedAt).getTime() !== configuration.updatedAt.getTime()) {
      throw conflict('The JWT reader access configuration changed during sign-in. Sign in again.');
    }
    const now = new Date();
    const existing = await tx.reader.findFirst({
      where: { projectId, OR: [{ externalSubject }, ...(email ? [{ email }] : [])] },
      select: { id: true, revokedAt: true },
    });
    if (existing?.revokedAt) throw badRequest('This reader identity has been revoked.');
    let id: string;
    if (existing) {
      const activated = await tx.reader.updateMany({
        where: { id: existing.id, projectId, revokedAt: null },
        data: { externalSubject, email, name, status: 'ACTIVE', activatedAt: now },
      });
      if (activated.count !== 1) throw badRequest('This reader identity has been revoked.');
      await tx.reader.update({
        where: { id: existing.id },
        data: { audiences: { deleteMany: {}, create: audienceIds.map((audienceId) => ({ audienceId })) } },
      });
      id = existing.id;
    } else {
      const created = await tx.reader.create({
        data: {
          projectId,
          externalSubject,
          email,
          name,
          status: 'ACTIVE',
          activatedAt: now,
          audiences: { create: audienceIds.map((audienceId) => ({ audienceId })) },
        },
        select: { id: true },
      });
      id = created.id;
    }
    await tx.readerSession.create({
      data: { projectId, readerId: id, tokenHash: sha256(sessionToken), source: 'JWT', expiresAt, ...fingerprint },
    });
    return id;
  });
  setSessionCookie(ctx, projectId, sessionToken, expiresAt);
  await logAudit({ projectId, readerId, action: 'JWT_SESSION_CREATED', ipHash: fingerprint.ipHash });
  return { readerId, expiresIn: configuration.sessionTtlMinutes * 60 };
};

export const logoutReader = async (ctx: Context<HonoEnv>, projectId: string) => {
  const token = getCookie(ctx, cookieName(projectId));
  if (token) {
    const where = { projectId, tokenHash: sha256(token), revokedAt: null };
    const revokedAt = new Date();
    await Promise.all([
      prisma.readerSession.updateMany({ where, data: { revokedAt } }),
      prisma.siteMemberSession.updateMany({ where, data: { revokedAt } }),
    ]);
  }
  deleteCookie(ctx, cookieName(projectId), { path: '/' });
  ctx.header('Cache-Control', 'private, no-store');
  return { ok: true };
};
