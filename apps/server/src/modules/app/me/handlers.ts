import { Hono } from 'hono';
import { z } from 'zod';
import {
  getPreferences,
  getSwitcher,
  listMyInvitations,
  type PersonalNotificationKey,
  recordLastOrganization,
  updatePreferences,
} from '@/actions/me';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import { isAuthenticated } from '@/middlewares/guard';

const id = z.string().min(1).max(64);
const lastOrganizationBody = z
  .object({ organizationId: id.optional(), projectId: id.optional() })
  .strict()
  .refine((body) => Boolean(body.organizationId) !== Boolean(body.projectId), { message: 'Send exactly one of organizationId or projectId.' });
const toggle = z.boolean().optional();
const notificationToggles = {
  workspace_weekly: toggle,
  workspace_plan: toggle,
  project_new: toggle,
  project_deploy: toggle,
  project_deploy_failed: toggle,
  member_joined: toggle,
  security_login: toggle,
} satisfies Record<PersonalNotificationKey, typeof toggle>; // every personal key, exactly
const preferencesBody = z.object({ notifications: z.object(notificationToggles).strict() }).strict();
const userId = () => getContextUserOrThrow().id;

// The signed-in person's own context: switcher data, landing/recent state,
// pending invitations and personal preferences. Nothing here takes an org or
// website from session state; every id in a body is authorized when used.
const app = new Hono<HonoEnv>()
  .get('/switcher', isAuthenticated, async (ctx) => ctx.json({ data: await getSwitcher(userId()) }, 200))
  .put('/last-organization', isAuthenticated, validator('json', lastOrganizationBody), async (ctx) =>
    ctx.json({ data: await recordLastOrganization(userId(), ctx.req.valid('json')) }, 200),
  )
  .get('/invitations', isAuthenticated, async (ctx) => ctx.json({ data: await listMyInvitations(userId()) }, 200))
  .get('/preferences', isAuthenticated, async (ctx) => ctx.json({ data: await getPreferences(userId()) }, 200))
  .put('/preferences', isAuthenticated, validator('json', preferencesBody), async (ctx) =>
    ctx.json({ data: await updatePreferences(userId(), ctx.req.valid('json')) }, 200),
  );

export default app;
