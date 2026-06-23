import { updateWorkspaceSettingsBody } from '@plume/validators';
import { Hono } from 'hono';
import { getWorkspaceSettings, updateWorkspaceSettings } from '@/actions/workspace';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import projectSettingsRoutes from './routes';

// organizationId here is the PROJECT's own org (resolved from :projectId by the
// guards), so these reuse the org-scoped settings actions but operate per-site.
const app = new Hono<HonoEnv>()
  .get('/', ...projectSettingsRoutes.get, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await getWorkspaceSettings(organizationId) }, 200);
  })
  .patch('/', ...projectSettingsRoutes.update, validator('json', updateWorkspaceSettingsBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await updateWorkspaceSettings(organizationId, ctx.req.valid('json')) }, 200);
  });

export default app;
