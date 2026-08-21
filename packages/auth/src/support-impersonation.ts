import { createHash } from 'node:crypto';
import { type Prisma, prisma } from '@nibleaf/database';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { deleteSessionCookie, expireCookie, setSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';

const GRANT_PREFIX = 'support-impersonation:';
const SESSION_SECONDS = 60 * 60;

type StoredGrant = {
  actorUserId: string;
  targetUserId: string;
  organizationId: string;
};

const grantIdentifier = (token: string) => `${GRANT_PREFIX}${createHash('sha256').update(token).digest('hex')}`;

const parseGrant = (value: string): StoredGrant | null => {
  try {
    const input = JSON.parse(value) as Partial<StoredGrant>;
    if (typeof input.actorUserId !== 'string' || typeof input.targetUserId !== 'string' || typeof input.organizationId !== 'string') {
      return null;
    }
    return input as StoredGrant;
  } catch {
    return null;
  }
};

const supportSessionBody = z.object({ token: z.string().min(32).max(256) }).strict();

/**
 * Minimal Better Auth plugin for cross-origin support access. Admin authorization
 * and grant creation happen on the isolated admin API. This endpoint runs on the
 * customer-app origin so the resulting signed cookie remains first-party there.
 */
export const supportImpersonation = () => ({
  id: 'support-impersonation' as const,
  schema: {
    session: {
      fields: {
        impersonatedBy: { type: 'string' as const, required: false, input: false },
      },
    },
  },
  endpoints: {
    consumeSupportImpersonation: createAuthEndpoint(
      '/support-impersonation/consume',
      { method: 'POST', requireHeaders: true, body: supportSessionBody },
      async (ctx) => {
        const identifier = grantIdentifier(ctx.body.token);
        const record = await prisma.$transaction(async (tx) => {
          const candidate = await tx.verification.findFirst({ where: { identifier, expiresAt: { gt: new Date() } } });
          if (!candidate) return null;
          const consumed = await tx.verification.deleteMany({ where: { id: candidate.id, identifier, expiresAt: { gt: new Date() } } });
          return consumed.count === 1 ? candidate : null;
        });
        const grant = record ? parseGrant(record.value) : null;
        if (!grant) {
          throw new APIError('UNAUTHORIZED', { message: 'This support-access link is invalid or has expired.' });
        }

        const [actor, target, membership] = await Promise.all([
          prisma.user.findUnique({ where: { id: grant.actorUserId }, select: { id: true, role: true } }),
          ctx.context.internalAdapter.findUserById(grant.targetUserId),
          prisma.member.findUnique({
            where: { organizationId_userId: { organizationId: grant.organizationId, userId: grant.targetUserId } },
            select: { id: true },
          }),
        ]);
        const targetState = await prisma.user.findUnique({
          where: { id: grant.targetUserId },
          select: { role: true, suspendedAt: true },
        });
        if (actor?.role !== 'admin' || !target || !membership || targetState?.role === 'admin' || targetState?.suspendedAt) {
          throw new APIError('FORBIDDEN', { message: 'Support access is no longer permitted for this account.' });
        }

        // Preserve an existing main-app admin session so Stop support access can
        // restore it. A non-admin/customer session is never retained or exposed.
        const original = await getSessionFromCtx(ctx).catch(() => null);
        const originalActor = original ? await prisma.user.findUnique({ where: { id: original.user.id }, select: { role: true } }) : null;
        const restoreCookie = ctx.context.createAuthCookie('support_admin_session');
        if (original && original.user.id === actor.id && originalActor?.role === 'admin') {
          await ctx.setSignedCookie(restoreCookie.name, original.session.token, ctx.context.secret, ctx.context.authCookies.sessionToken.attributes);
        }

        const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
        const session = await ctx.context.internalAdapter.createSession(
          target.id,
          true,
          { impersonatedBy: actor.id, activeOrganizationId: grant.organizationId, expiresAt },
          true,
        );
        if (!session) {
          throw new APIError('INTERNAL_SERVER_ERROR', { message: 'Could not create the support session.' });
        }

        deleteSessionCookie(ctx);
        await setSessionCookie(ctx, { session, user: target }, true);
        await prisma.platformEvent
          .create({
            data: {
              type: 'admin_impersonation_started',
              userId: target.id,
              metadata: { actorUserId: actor.id, organizationId: grant.organizationId } as Prisma.InputJsonValue,
            },
          })
          .catch(() => undefined);
        return ctx.json({ ok: true, expiresAt: expiresAt.toISOString() });
      },
    ),
    stopSupportImpersonation: createAuthEndpoint('/support-impersonation/stop', { method: 'POST', requireHeaders: true }, async (ctx) => {
      const current = await getSessionFromCtx(ctx);
      const actorUserId = current?.session.impersonatedBy as string | undefined;
      if (!current || !actorUserId) {
        throw new APIError('BAD_REQUEST', { message: 'No support session is active.' });
      }

      const restoreCookie = ctx.context.createAuthCookie('support_admin_session');
      const restoreToken = await ctx.getSignedCookie(restoreCookie.name, ctx.context.secret);
      const restore = restoreToken ? await ctx.context.internalAdapter.findSession(restoreToken) : null;
      const restoreActor = restore ? await prisma.user.findUnique({ where: { id: restore.user.id }, select: { role: true } }) : null;

      await ctx.context.internalAdapter.deleteSession(current.session.token);
      if (restore && restore.user.id === actorUserId && restoreActor?.role === 'admin' && restore.session.expiresAt > new Date()) {
        await setSessionCookie(ctx, restore);
      } else {
        deleteSessionCookie(ctx);
      }
      expireCookie(ctx, restoreCookie);
      await prisma.platformEvent
        .create({
          data: {
            type: 'admin_impersonation_ended',
            userId: current.user.id,
            metadata: { actorUserId } as Prisma.InputJsonValue,
          },
        })
        .catch(() => undefined);
      return ctx.json({ ok: true });
    }),
  },
});
