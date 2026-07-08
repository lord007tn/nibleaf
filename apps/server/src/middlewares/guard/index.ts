import { prisma } from '@nibleaf/database';
import type { MemberRole } from '@nibleaf/shared/constants';
import { hashApiKeySecret } from '@nibleaf/shared/crypto';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import type { Context, MiddlewareHandler } from 'hono';
import { assertProjectAccess } from '@/actions/projects';
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

/** Require the user's role in the active (session) org to be at least `required`.
 *  Used by genuinely org-level routes (workspace settings, account members). */
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

/**
 * Resolve a project's OWN organization (from its `:projectId` / `:id` path param)
 * and the caller's role in it, then pin both onto the request context. This makes
 * access = membership in the site's own org, so every downstream handler that
 * reads `organizationId` is scoped to the project, not the session's active org.
 */
const resolveProjectOrg = async (ctx: Context<HonoEnv>, paramKey: string): Promise<MemberRole> => {
  const user = ctx.get('user');
  if (!user) {
    throw new AppError({ code: 'auth:no_user', message: 'Authentication required.' });
  }
  const projectId = ctx.req.param(paramKey);
  if (!projectId) {
    throw new AppError({ code: 'http:bad_request', message: 'Missing project id.' });
  }
  const { organizationId, role } = await assertProjectAccess(user.id, projectId);
  ctx.set('organizationId', organizationId);
  ctx.set('membership', { organizationId, role });
  return role;
};

/** Require the caller to be a member of the project's org (any role). */
export const requireProjectMember =
  (paramKey = 'projectId'): MiddlewareHandler<HonoEnv> =>
  async (ctx, next) => {
    await resolveProjectOrg(ctx, paramKey);
    await next();
  };

/** Require the caller's role in the project's org to be at least `required`. */
export const requireProjectRole =
  (required: MemberRole, paramKey = 'projectId'): MiddlewareHandler<HonoEnv> =>
  async (ctx, next) => {
    const role = await resolveProjectOrg(ctx, paramKey);
    if (!roleAtLeast(role, required)) {
      throw new AppError({ code: 'auth:insufficient_role' });
    }
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
