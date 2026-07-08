import { prisma } from '@nibleaf/database';
import type { MiddlewareHandler } from 'hono';
import { forbidden } from '@/errors';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';

/**
 * Gate an internal admin-panel route (apps/admin). The signed-in user must have
 * the platform role `admin`. The role is read fresh from the database (not the
 * session) so a revoked admin loses access on their next request. Pair this
 * AFTER `isAuthenticated`.
 */
export const isAdmin: MiddlewareHandler<HonoEnv> = async (_ctx, next) => {
  const { id } = getContextUserOrThrow();
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (user?.role !== 'admin') {
    throw forbidden('Admin access required.');
  }
  await next();
};
