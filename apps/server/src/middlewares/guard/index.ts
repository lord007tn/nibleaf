import { prisma } from '@nibleaf/database';
import type { MemberRole } from '@nibleaf/shared/constants';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import type { Context, MiddlewareHandler } from 'hono';
import { assertProjectAccess } from '@/actions/projects';
import { AppError, conflict } from '@/errors';
import { accessibleProjectIds, assertUsableAccount, resolveOrgAccess } from '@/lib/access';
import type { HonoEnv } from '@/lib/hono/context';

/** Require a signed-in dashboard user. Suspended accounts are rejected outright:
 *  suspension deletes their sessions and blocks new sign-ins, but any session
 *  that slips through (e.g. a race during suspension) must still be locked out.
 *  Read fresh from the DB — like `isAdmin` — so the lockout is immediate. */
export const isAuthenticated: MiddlewareHandler<HonoEnv> = async (ctx, next) => {
  const user = ctx.get('user');
  if (!user) {
    throw new AppError({ code: 'auth:no_user', message: 'Authentication required.' });
  }
  await assertUsableAccount(user.id);
  await next();
};

/** Organization authorization always reads the organization from the path. */
export const requireOrgRole =
  (required: MemberRole, param = 'organizationId', options: { resumeDeletion?: boolean } = {}): MiddlewareHandler<HonoEnv> =>
  async (ctx, next) => {
    const user = ctx.get('user');
    const organizationId = ctx.req.param(param);
    if (!(user && organizationId)) {
      throw new AppError({ code: 'auth:no_user' });
    }
    const { orgRole } = await resolveOrgAccess(user.id, organizationId);
    const role = orgRole as MemberRole;
    if (!roleAtLeast(role, required)) {
      throw new AppError({ code: 'auth:insufficient_role' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(ctx.req.method)) {
      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { needsRepair: true, deletionStartedAt: true },
      });
      // Only the deletion route itself may continue a started (interrupted) deletion.
      if (organization.needsRepair || (organization.deletionStartedAt && !options.resumeDeletion))
        throw conflict('This organization cannot be changed right now.');
    }
    ctx.set('membership', { organizationId, role });
    ctx.set('organizationId', organizationId);
    await next();
  };

/** Compatibility for the old 1:1 routes. Callers must identify their website
 * explicitly; the session's selected organization never authorizes a request. */
export const requireLegacyProjectRole =
  (required: MemberRole): MiddlewareHandler<HonoEnv> =>
  async (ctx, next) => {
    const user = ctx.get('user');
    let projectId = ctx.req.param('projectId') ?? ctx.req.query('projectId');
    if (!user) throw new AppError({ code: 'auth:no_user' });
    if (!projectId) {
      const ids = await accessibleProjectIds(user.id);
      if (ids.length === 1) projectId = ids[0];
    }
    if (!projectId) throw new AppError({ code: 'http:bad_request', message: 'Identify a website with projectId.' });
    const { organizationId, role } = await assertProjectAccess(user.id, projectId);
    if (!roleAtLeast(role, required)) throw new AppError({ code: 'auth:insufficient_role' });
    ctx.set('organizationId', organizationId);
    ctx.set('membership', { organizationId, role });
    await next();
  };

/**
 * Resolve a project's OWN organization (from its `:projectId` / `:id` path param)
 * and the caller's role in it, then pin both onto the request context. This makes
 * access uses the effective site role, so every downstream handler that
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

/** Website actions that §4.2 reserves for the organization (deleting a
 *  website): the caller must reach the website (else 404) and hold the org
 *  Owner/Admin role — a site-only Admin grant is not enough (403). */
export const requireProjectOrgRole =
  (required: MemberRole, paramKey = 'projectId'): MiddlewareHandler<HonoEnv> =>
  async (ctx, next) => {
    await resolveProjectOrg(ctx, paramKey);
    const user = ctx.get('user');
    const organizationId = ctx.get('organizationId');
    if (!(user && organizationId)) throw new AppError({ code: 'auth:no_user' });
    const { orgRole } = await resolveOrgAccess(user.id, organizationId);
    if (!roleAtLeast(orgRole as MemberRole, required)) throw new AppError({ code: 'auth:insufficient_role' });
    await next();
  };
