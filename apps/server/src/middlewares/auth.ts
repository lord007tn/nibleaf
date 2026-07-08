import { auth } from '@nibleaf/auth/server';
import { prisma } from '@nibleaf/database';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '@/lib/hono/context';

/**
 * Populate the request context with the better-auth session/user (or nulls).
 * Runs on every request; route guards enforce presence.
 */
export const sessionMiddleware = (): MiddlewareHandler<HonoEnv> => async (ctx, next) => {
  ctx.set('apiKey', null);
  ctx.set('project', null);
  ctx.set('membership', null);

  try {
    const result = await auth.api.getSession({ headers: ctx.req.raw.headers });
    if (result?.user && result.session) {
      let activeOrganizationId = (result.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
      // Fall back to the user's first workspace when none is explicitly active,
      // so the dashboard works right after sign-up without an explicit setActive.
      if (!activeOrganizationId) {
        const member = await prisma.member.findFirst({ where: { userId: result.user.id }, orderBy: { createdAt: 'asc' } });
        activeOrganizationId = member?.organizationId ?? null;
      }
      ctx.set('user', {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        image: result.user.image ?? null,
      });
      ctx.set('session', {
        id: result.session.id,
        userId: result.session.userId,
        expiresAt: result.session.expiresAt,
        activeOrganizationId,
      });
      ctx.set('organizationId', activeOrganizationId);
    } else {
      ctx.set('user', null);
      ctx.set('session', null);
      ctx.set('organizationId', null);
    }
  } catch {
    ctx.set('user', null);
    ctx.set('session', null);
    ctx.set('organizationId', null);
  }

  await next();
};
