import {
  saveWorkspaceAiConnectionBody,
  searchIndexDiagnosticsQuery,
  updateProjectSearchConfigurationBody,
  updateWorkspaceSettingsBody,
  workspaceAiModelsBody,
  workspaceAiSelectionBody,
} from '@nibleaf/validators';
import { Hono } from 'hono';
import { importFromGitProvider } from '@/actions/git-import';
import { rotateGitWebhookSecret } from '@/actions/git-webhook-secret';
import { createNotificationsForOrgMembers } from '@/actions/notifications';
import {
  createProjectSearchReindex,
  getProjectSearchConfiguration,
  getProjectSearchIndexDiagnostics,
  updateProjectSearchConfiguration,
} from '@/actions/search';
import { getProjectUsageSummary } from '@/actions/usage';
import { getScopedWorkspaceSettings, updateWorkspaceSettings } from '@/actions/workspace';
import { getWorkspaceAi, getWorkspaceAiModels, saveWorkspaceAiConnection, selectWorkspaceAi } from '@/actions/workspace-ai';
import { getContextMembership, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import projectSettingsRoutes from './routes';

// Guards resolve the owning org; website settings always use the explicit projectId.
const app = new Hono<HonoEnv>()
  .get('/', ...projectSettingsRoutes.get, async (ctx) => {
    // Same scoped DTO as the workspace settings GET: the webhook secret is
    // ADMIN material, and this GET is member-level.
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await getScopedWorkspaceSettings(organizationId, getContextMembership()?.role ?? '', ctx.req.param('projectId')) }, 200);
  })
  .patch('/', ...projectSettingsRoutes.update, validator('json', updateWorkspaceSettingsBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    await updateWorkspaceSettings(organizationId, ctx.req.valid('json'), ctx.req.param('projectId'));
    return ctx.json({ data: await getScopedWorkspaceSettings(organizationId, getContextMembership()?.role ?? '', ctx.req.param('projectId')) }, 200);
  })
  .get('/ai', ...projectSettingsRoutes.update, async (ctx) => ctx.json({ data: await getWorkspaceAi(ctx, ctx.req.param('projectId') ?? '') }, 200))
  .post('/ai/models', ...projectSettingsRoutes.update, validator('json', workspaceAiModelsBody), async (ctx) =>
    ctx.json({ data: await getWorkspaceAiModels(ctx, ctx.req.param('projectId') ?? '', ctx.req.valid('json')) }, 200),
  )
  .put('/ai/connection', ...projectSettingsRoutes.update, validator('json', saveWorkspaceAiConnectionBody), async (ctx) =>
    ctx.json({ data: await saveWorkspaceAiConnection(ctx, ctx.req.param('projectId') ?? '', ctx.req.valid('json')) }, 200),
  )
  .patch('/ai', ...projectSettingsRoutes.update, validator('json', workspaceAiSelectionBody), async (ctx) =>
    ctx.json({ data: await selectWorkspaceAi(ctx, ctx.req.param('projectId') ?? '', ctx.req.valid('json')) }, 200),
  )
  .post('/git/import', ...projectSettingsRoutes.gitImport, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    // Always present — the module is mounted under /projects/:projectId/settings.
    const projectId = ctx.req.param('projectId') ?? '';
    const summary = await importFromGitProvider(organizationId, projectId);
    // Tell the acting admin's fellow members (bell inbox). Best-effort.
    await createNotificationsForOrgMembers(
      projectId,
      {
        type: 'import_completed',
        params: { imported: summary.imported, updated: summary.updated, source: 'git' },
        title: 'Content import completed',
        body: `${summary.imported} pages imported and ${summary.updated} updated from the connected Git repository.`,
        href: `/app/projects/${projectId}`,
      },
      user.id,
    ).catch(() => undefined);
    return ctx.json({ data: summary }, 200);
  })
  // Generate/rotate the push-to-deploy webhook secret. Server-side generation
  // only — the settings PATCH schema cannot set it (see gitConfigSchema note).
  .post('/git/webhook-secret', ...projectSettingsRoutes.gitWebhookSecret, async (ctx) =>
    ctx.json({ data: { webhookSecret: await rotateGitWebhookSecret(ctx.req.param('projectId') ?? '') } }, 200),
  )
  .get('/usage', ...projectSettingsRoutes.usage, async (ctx) => {
    const projectId = ctx.req.param('projectId') ?? '';
    return ctx.json({ data: await getProjectUsageSummary(ctx, projectId) }, 200);
  })
  .get('/search', ...projectSettingsRoutes.searchConfiguration, async (ctx) =>
    ctx.json({ data: await getProjectSearchConfiguration(ctx, ctx.req.param('projectId') ?? '') }, 200),
  )
  .patch('/search', ...projectSettingsRoutes.updateSearchConfiguration, validator('json', updateProjectSearchConfigurationBody), async (ctx) =>
    ctx.json({ data: await updateProjectSearchConfiguration(ctx, ctx.req.param('projectId') ?? '', ctx.req.valid('json')) }, 200),
  )
  .get('/search/diagnostics', ...projectSettingsRoutes.searchIndexDiagnostics, validator('query', searchIndexDiagnosticsQuery), async (ctx) =>
    ctx.json({ data: await getProjectSearchIndexDiagnostics(ctx, ctx.req.param('projectId') ?? '', ctx.req.valid('query')) }, 200),
  )
  .post('/search/reindex', ...projectSettingsRoutes.createSearchReindex, async (ctx) =>
    ctx.json({ data: await createProjectSearchReindex(ctx, ctx.req.param('projectId') ?? '') }, 202),
  );

export default app;
