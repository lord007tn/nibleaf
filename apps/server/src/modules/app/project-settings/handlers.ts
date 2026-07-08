import { updateWorkspaceSettingsBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { importFromGitProvider } from '@/actions/git-import';
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
  })
  .post('/git/import', ...projectSettingsRoutes.gitImport, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    // Always present — the module is mounted under /projects/:projectId/settings.
    const projectId = ctx.req.param('projectId') ?? '';
    return ctx.json({ data: await importFromGitProvider(organizationId, projectId) }, 200);
  });

export default app;
