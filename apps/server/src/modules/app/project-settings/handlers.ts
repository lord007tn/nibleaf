import { MemberRole } from '@nibleaf/shared/constants';
import { roleAtLeast } from '@nibleaf/shared/rbac';
import { updateWorkspaceSettingsBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { importFromGitProvider } from '@/actions/git-import';
import { rotateGitWebhookSecret } from '@/actions/git-webhook';
import { createNotificationsForOrgMembers } from '@/actions/notifications';
import { getProjectUsage } from '@/actions/usage';
import { getWorkspaceSettings, updateWorkspaceSettings } from '@/actions/workspace';
import { getContextMembership, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import projectSettingsRoutes from './routes';

// organizationId here is the PROJECT's own org (resolved from :projectId by the
// guards), so these reuse the org-scoped settings actions but operate per-site.
const app = new Hono<HonoEnv>()
  .get('/', ...projectSettingsRoutes.get, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const settings = await getWorkspaceSettings(organizationId);
    // The push-webhook secret is admin material (it authenticates deploy
    // triggers); the GET is member-level, so strip it below ADMIN. The UI
    // hides the webhook card for those members anyway.
    if (!roleAtLeast(getContextMembership()?.role ?? '', MemberRole.ADMIN) && settings.git && typeof settings.git === 'object') {
      const { webhookSecret: _webhookSecret, ...git } = settings.git as Record<string, unknown>;
      settings.git = git;
    }
    return ctx.json({ data: settings }, 200);
  })
  .patch('/', ...projectSettingsRoutes.update, validator('json', updateWorkspaceSettingsBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await updateWorkspaceSettings(organizationId, ctx.req.valid('json')) }, 200);
  })
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
  .post('/git/webhook-secret', ...projectSettingsRoutes.gitWebhookSecret, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: { webhookSecret: await rotateGitWebhookSecret(organizationId) } }, 200);
  })
  .get('/usage', ...projectSettingsRoutes.usage, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const projectId = ctx.req.param('projectId') ?? '';
    return ctx.json({ data: await getProjectUsage(organizationId, projectId) }, 200);
  });

export default app;
