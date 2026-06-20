import { prisma } from '@plume/database';
import type { MemberRole } from '@plume/shared/constants';
import { hashApiKeySecret } from '@plume/shared/crypto';
import { roleAtLeast } from '@plume/shared/rbac';
import type { MiddlewareHandler } from 'hono';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

/** Require a signed-in dashboard user. */
export const isAuthenticated: MiddlewareHandler<HonoEnv> = async (ctx, next) => {
  if (!ctx.get('user')) {
    throw new AppError({ code: 'auth:no_user', message: 'Authentication required.' });
  }
  await next();
};

/** Require an active organization (workspace) in the session. */
export const hasOrganization: MiddlewareHandler<HonoEnv> = async (ctx, next) => {
  if (!ctx.get('organizationId')) {
    throw new AppError({ code: 'http:bad_request', message: 'No active workspace selected.' });
  }
  await next();
};

/** Require the user's role in the active org to be at least `required`. */
export const requireRole =
  (required: MemberRole): MiddlewareHandler<HonoEnv> =>
  async (ctx, next) => {
    const user = ctx.get('user');
    const organizationId = ctx.get('organizationId');
    if (!(user && organizationId)) {
      throw new AppError({ code: 'auth:no_user' });
    }
    const member = await prisma.member.findUnique({
      where: { organizationId_userId: { organizationId, userId: user.id } },
    });
    if (!member) {
      throw new AppError({ code: 'auth:insufficient_role', message: 'Not a member of this workspace.' });
    }
    const role = member.role as MemberRole;
    if (!roleAtLeast(role, required)) {
      throw new AppError({ code: 'auth:insufficient_role' });
    }
    ctx.set('membership', { organizationId, role });
    await next();
  };

/** Authenticate an SDK request via `Authorization: Bearer plm_...`. */
export const requireApiKey: MiddlewareHandler<HonoEnv> = async (ctx, next) => {
  const header = ctx.req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) {
    throw new AppError({ code: 'auth:invalid_api_key', message: 'Missing API key.' });
  }

  const hashedSecret = hashApiKeySecret(token);
  const key = await prisma.apiKey.findFirst({ where: { hashedSecret, revokedAt: null }, include: { project: true } });
  if (!key) {
    throw new AppError({ code: 'auth:invalid_api_key', message: 'Invalid or revoked API key.' });
  }

  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  ctx.set('apiKey', { id: key.id, projectId: key.projectId, scopes: key.scopes });
  ctx.set('project', { id: key.project.id, organizationId: key.project.organizationId, name: key.project.name });
  ctx.set('organizationId', key.project.organizationId);
  await next();
};
