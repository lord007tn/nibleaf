import { adminSetRoleBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  getAdminOverview,
  inviteOrganizationOwner,
  listAdminSites,
  listAdminUsers,
  restoreProject,
  setUserRole,
  suspendUser,
  takedownProject,
  unsuspendUser,
} from '@/actions/admin';
import { getActivationFunnel } from '@/actions/platform-events';
import type { HonoEnv } from '@/lib/hono/context';
import { getContextUserOrThrow } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import adminRoutes from './routes';

// Local to the admin surface (not part of the shared SDK contract), so the
// schema lives here rather than in @nibleaf/validators.
const adminTakedownBody = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
const adminInviteOrganizationBody = z
  .object({
    organizationName: z.string().trim().min(1).max(100),
    siteName: z.string().trim().min(1).max(100),
    ownerEmail: z.email(),
    siteSlug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1)
      .max(63)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    description: z.string().trim().max(500).optional(),
    delivery: z.enum(['email', 'link']).default('email'),
  })
  .strict();

const app = new Hono<HonoEnv>()
  .get('/overview', ...adminRoutes.overview, async (ctx) => ctx.json({ data: await getAdminOverview() }, 200))
  .get('/funnel', ...adminRoutes.funnel, async (ctx) => ctx.json({ data: await getActivationFunnel() }, 200))
  .get('/users', ...adminRoutes.users, async (ctx) => ctx.json({ data: await listAdminUsers() }, 200))
  .post('/users/:id/role', ...adminRoutes.setRole, validator('json', adminSetRoleBody), async (ctx) =>
    ctx.json({ data: await setUserRole(ctx.req.param('id'), ctx.req.valid('json').role) }, 200),
  )
  .post('/users/:id/suspend', ...adminRoutes.suspendUser, async (ctx) => ctx.json({ data: await suspendUser(ctx.req.param('id')) }, 200))
  .post('/users/:id/unsuspend', ...adminRoutes.unsuspendUser, async (ctx) => ctx.json({ data: await unsuspendUser(ctx.req.param('id')) }, 200))
  .get('/sites', ...adminRoutes.sites, async (ctx) => ctx.json({ data: await listAdminSites() }, 200))
  .post('/organizations/invite', ...adminRoutes.inviteOrganization, validator('json', adminInviteOrganizationBody), async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: await inviteOrganizationOwner(user.id, ctx.req.valid('json')) }, 201);
  })
  .post('/sites/:id/takedown', ...adminRoutes.takedownSite, validator('json', adminTakedownBody), async (ctx) =>
    ctx.json({ data: await takedownProject(ctx.req.param('id'), ctx.req.valid('json').reason) }, 200),
  )
  .post('/sites/:id/restore', ...adminRoutes.restoreSite, async (ctx) => ctx.json({ data: await restoreProject(ctx.req.param('id')) }, 200));

export default app;
