import { analyticsQuery, updateWorkspaceSettingsBody } from '@plume/validators';
import { Hono } from 'hono';
import { validator } from 'hono-openapi';
import { getWorkspaceAnalytics } from '@/actions/analytics';
import { getWorkspaceSettings, updateWorkspaceSettings } from '@/actions/workspace';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import workspaceRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/analytics', ...workspaceRoutes.analytics, validator('query', analyticsQuery), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const { range } = ctx.req.valid('query');
    return ctx.json({ data: await getWorkspaceAnalytics(organizationId, range) }, 200);
  })
  .get('/', ...workspaceRoutes.settings, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await getWorkspaceSettings(organizationId) }, 200);
  })
  .patch('/', ...workspaceRoutes.updateSettings, validator('json', updateWorkspaceSettingsBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await updateWorkspaceSettings(organizationId, ctx.req.valid('json')) }, 200);
  });

export default app;
