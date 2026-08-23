import { createHash, randomBytes } from 'node:crypto';
import { auth } from '@nibleaf/auth/server';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { Prisma, prisma } from '@nibleaf/database';
import type {
  CreateAudienceBody,
  InviteReaderBody,
  JwtAccessConfigBody,
  ProjectAccessModeBody,
  UpdateAudienceBody,
  UpdateReaderBody,
} from '@nibleaf/validators';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { env } from '@/env';
import { badRequest, conflict, notFound } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';
import { assertPublicJwksUrl, claimAt, claimStrings, isJwtVerificationError, jwtReplayHash, verifyReaderJwt } from '@/lib/reader-jwt';

const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60_000;
const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const newSecret = (): string => randomBytes(32).toString('base64url');
const cookieName = (projectId: string): string => `nibleaf_reader_${projectId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
const requestFingerprint = (ctx: Context<HonoEnv>) => ({
  ipHash: ctx.req.header('x-forwarded-for') ? sha256(ctx.req.header('x-forwarded-for') as string) : null,
  userAgentHash: ctx.req.header('user-agent') ? sha256(ctx.req.header('user-agent') as string) : null,
});

const logAudit = (data: {
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
}

const workspaceViewer = async (projectId: string, headers: Headers): Promise<boolean> => {
  const result = await auth.api.getSession({ headers }).catch(() => null);
  if (!result?.user?.id) return false;
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) return false;
  return Boolean(
    await prisma.member.findUnique({
      where: { organizationId_userId: { organizationId: project.organizationId, userId: result.user.id } },
      select: { id: true },
    }),
  );
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
  if (await workspaceViewer(projectId, headers)) return { kind: 'workspace', allowedPageIds: null };
  if (accessMode === 'WORKSPACE') return null;

  const rawCookie = headers.get('cookie') ?? '';
  const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${cookieName(projectId)}=([^;]+)`));
  let token: string | null = null;
  try {
    token = match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
  if (!token) return null;
  const session = await prisma.readerSession.findFirst({
    where: { projectId, tokenHash: sha256(token), revokedAt: null, expiresAt: { gt: new Date() }, reader: { revokedAt: null, status: 'ACTIVE' } },
    select: {
      id: true,
      readerId: true,
      lastUsedAt: true,
      reader: { select: { audiences: { select: { audience: { select: { grants: { select: { pageId: true } } } } } } } },
    },
  });
  if (!session) return null;
  const grants = session.reader.audiences.flatMap((membership) => membership.audience.grants);
  if (Date.now() - session.lastUsedAt.getTime() > 5 * 60_000) {
    void Promise.all([
      prisma.readerSession.update({ where: { id: session.id }, data: { lastUsedAt: new Date() } }),
      prisma.reader.update({ where: { id: session.readerId }, data: { lastSeenAt: new Date() } }),
    ]).catch(() => undefined);
  }
  return {
    kind: 'reader',
    readerId: session.readerId,
    allowedPageIds: grants.some((grant) => grant.pageId === null) ? null : new Set(grants.flatMap((grant) => (grant.pageId ? [grant.pageId] : []))),
  };
};

const setSessionCookie = (ctx: Context<HonoEnv>, projectId: string, token: string, expiresAt: Date): void => {
  setCookie(ctx, cookieName(projectId), token, {
    httpOnly: true,
    secure: env.APP_URL.startsWith('https://'),
    sameSite: 'Lax',
    path: '/',
    expires: expiresAt,
  });
  ctx.header('Cache-Control', 'private, no-store');
};

const issueSession = async (ctx: Context<HonoEnv>, projectId: string, readerId: string, source: string, ttlMs: number) => {
  const token = newSecret();
  const expiresAt = new Date(Date.now() + ttlMs);
  await prisma.readerSession.create({
    data: { projectId, readerId, tokenHash: sha256(token), source, expiresAt, ...requestFingerprint(ctx) },
  });
  setSessionCookie(ctx, projectId, token, expiresAt);
  return expiresAt;
};

export const listReaderAccess = async (projectId: string) => {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { accessMode: true } });
  if (!project) throw notFound('project', { id: projectId });
  const [readers, audiences, jwt, audit] = await Promise.all([
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
  ]);
  return { accessMode: project.accessMode, readers, audiences, jwt, audit };
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

export const inviteReader = async (projectId: string, actorUserId: string, body: InviteReaderBody) => {
  await assertAudiences(projectId, body.audienceIds);
  const reader = await prisma.reader.upsert({
    where: { projectId_email: { projectId, email: body.email } },
    create: {
      projectId,
      email: body.email,
      name: body.name,
      audiences: { create: [...new Set(body.audienceIds)].map((audienceId) => ({ audienceId })) },
    },
    update: {
      name: body.name,
      status: 'INVITED',
      revokedAt: null,
      audiences: { deleteMany: {}, create: [...new Set(body.audienceIds)].map((audienceId) => ({ audienceId })) },
    },
  });
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
  const subject = `Your access to ${project?.name ?? 'private documentation'}`;
  const text = `Open this one-time link to access ${project?.name ?? 'the documentation'}:\n\n${activationUrl}\n\nThis link expires in 7 days.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px"><h2>Private documentation access</h2><p>You were invited to read <strong>${escapeHtml(project?.name ?? 'private documentation')}</strong>.</p><p><a href="${activationUrl}">Activate reader access</a></p><p>This one-time link expires in 7 days.</p></div>`;
  await createJob(QueueNames.EMAIL, { name: 'send-email', data: { to: body.email, subject, text, html } }).catch(() => undefined);
  await logAudit({ projectId, readerId: reader.id, actorUserId, action: 'READER_INVITED' });
  return { reader, invitation: { id: invitation.id, expiresAt: invitation.expiresAt }, activationUrl };
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

export const revokeReader = async (projectId: string, readerId: string, actorUserId: string) => {
  const reader = await prisma.reader.findFirst({ where: { id: readerId, projectId } });
  if (!reader) throw notFound('reader', { id: readerId });
  const now = new Date();
  await prisma.$transaction([
    prisma.reader.update({ where: { id: readerId }, data: { status: 'REVOKED', revokedAt: now } }),
    prisma.readerSession.updateMany({ where: { projectId, readerId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.readerInvitation.updateMany({ where: { projectId, readerId, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  await logAudit({ projectId, readerId, actorUserId, action: 'READER_REVOKED' });
  return { id: readerId };
};

export const emergencyRevoke = async (projectId: string, actorUserId: string) => {
  const now = new Date();
  const [sessions, invitations] = await prisma.$transaction([
    prisma.readerSession.updateMany({ where: { projectId, revokedAt: null }, data: { revokedAt: now } }),
    prisma.readerInvitation.updateMany({ where: { projectId, acceptedAt: null, revokedAt: null }, data: { revokedAt: now } }),
    prisma.jwtAccessProvider.updateMany({ where: { projectId }, data: { enabled: false } }),
  ]);
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
  const accepted = await prisma.readerInvitation.updateMany({
    where: { id: invitation.id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { acceptedAt: new Date() },
  });
  if (accepted.count !== 1) throw conflict('This reader invitation has already been used.');
  await prisma.reader.update({ where: { id: invitation.readerId }, data: { status: 'ACTIVE', activatedAt: new Date(), revokedAt: null } });
  await issueSession(ctx, invitation.projectId, invitation.readerId, 'INVITATION', DEFAULT_SESSION_TTL_MS);
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
  const externalSubject = `${configuration.issuer}\0${subject}`;
  const rawEmail = claimAt(payload, configuration.emailClaim);
  const rawName = claimAt(payload, configuration.nameClaim);
  const email = typeof rawEmail === 'string' && rawEmail.includes('@') ? rawEmail.trim().toLowerCase().slice(0, 320) : null;
  const name = typeof rawName === 'string' ? rawName.trim().slice(0, 120) || null : null;
  // Merge an invited email identity with its first SSO handoff instead of
  // creating a duplicate. An explicit per-reader revocation is sticky: SSO
  // cannot silently reactivate that identity; an admin must re-invite it.
  const existing = await prisma.reader.findFirst({
    where: { projectId, OR: [{ externalSubject }, ...(email ? [{ email }] : [])] },
    select: { id: true, revokedAt: true },
  });
  if (existing?.revokedAt) throw badRequest('This reader identity has been revoked.');
  const reader = existing
    ? await prisma.reader.update({
        where: { id: existing.id },
        data: {
          externalSubject,
          email,
          name,
          status: 'ACTIVE',
          activatedAt: new Date(),
          audiences: { deleteMany: {}, create: audienceIds.map((audienceId) => ({ audienceId })) },
        },
      })
    : await prisma.reader.create({
        data: {
          projectId,
          externalSubject,
          email,
          name,
          status: 'ACTIVE',
          activatedAt: new Date(),
          audiences: { create: audienceIds.map((audienceId) => ({ audienceId })) },
        },
      });
  await issueSession(ctx, projectId, reader.id, 'JWT', configuration.sessionTtlMinutes * 60_000);
  await logAudit({ projectId, readerId: reader.id, action: 'JWT_SESSION_CREATED', ipHash: requestFingerprint(ctx).ipHash });
  return { readerId: reader.id, expiresIn: configuration.sessionTtlMinutes * 60 };
};

export const logoutReader = async (ctx: Context<HonoEnv>, projectId: string) => {
  const token = getCookie(ctx, cookieName(projectId));
  if (token)
    await prisma.readerSession.updateMany({ where: { projectId, tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
  deleteCookie(ctx, cookieName(projectId), { path: '/' });
  ctx.header('Cache-Control', 'private, no-store');
  return { ok: true };
};
