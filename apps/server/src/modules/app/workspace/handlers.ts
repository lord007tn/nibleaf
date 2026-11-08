import { analyticsQuery, updateWorkspaceSettingsBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { getWorkspaceAnalytics } from '@/actions/analytics';
import { getScopedWorkspaceSettings, updateWorkspaceSettings } from '@/actions/workspace';
import { getContextMembershipOrThrow, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import workspaceRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/analytics', ...workspaceRoutes.analytics, validator('query', analyticsQuery), async (ctx) => {
    // Workspace analytics span every site the user can reach (all their orgs),
    // not just the session's active org — see getWorkspaceAnalytics.
    const user = getContextUserOrThrow();
    const { range, timezone } = ctx.req.valid('query');
    return ctx.json({ data: await getWorkspaceAnalytics(user.id, range, timezone) }, 200);
  })
  .get('/', ...workspaceRoutes.settings, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await getScopedWorkspaceSettings(organizationId, getContextMembershipOrThrow().role) }, 200);
  })
  .patch('/', ...workspaceRoutes.updateSettings, validator('json', updateWorkspaceSettingsBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    await updateWorkspaceSettings(organizationId, ctx.req.valid('json'));
    return ctx.json({ data: await getScopedWorkspaceSettings(organizationId, getContextMembershipOrThrow().role) }, 200);
  });

export default app;
