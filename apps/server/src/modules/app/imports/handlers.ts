import { ghostImportBody, mintlifyImportBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { type ImportSummary, importers } from '@/actions/importers';
import { createNotificationsForOrgMembers } from '@/actions/notifications';
import { badRequest } from '@/errors';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import importsRoutes from './routes';

/** Ghost exports ship the whole site in one JSON document — allow up to 15 MB. */
const GHOST_MAX_BODY_BYTES = 15 * 1024 * 1024;

/** Tell the acting admin's fellow members an import landed (bell inbox). Best-effort. */
const notifyImportCompleted = (projectId: string, actorUserId: string, source: string, summary: ImportSummary) =>
  createNotificationsForOrgMembers(
    projectId,
    {
      type: 'import_completed',
      title: 'Content import completed',
      body: `${summary.imported} pages imported and ${summary.updated} updated from ${source}.`,
      href: `/app/projects/${projectId}`,
    },
    actorUserId,
  ).catch(() => undefined);

// organizationId is the PROJECT's own org (resolved from :projectId by the guards),
// mirroring the project-settings module. Mounted under /projects/:projectId/settings/import.
const app = new Hono<HonoEnv>()
  .post('/mintlify', ...importsRoutes.mintlify, validator('json', mintlifyImportBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    // Always present — the module is mounted under /projects/:projectId/settings/import.
    const projectId = ctx.req.param('projectId') ?? '';
    const summary = await importers.mintlify.run({ organizationId, projectId, input: ctx.req.valid('json') });
    await notifyImportCompleted(projectId, user.id, 'Mintlify', summary);
    return ctx.json({ data: summary }, 200);
  })
  .post(
    '/ghost',
    ...importsRoutes.ghost,
    bodyLimit({
      maxSize: GHOST_MAX_BODY_BYTES,
      onError: () => {
        throw badRequest('The Ghost export is larger than 15 MB. Split the export and try again.');
      },
    }),
    validator('json', ghostImportBody),
    async (ctx) => {
      const organizationId = getContextOrganizationIdOrThrow();
      const user = getContextUserOrThrow();
      const projectId = ctx.req.param('projectId') ?? '';
      const summary = await importers.ghost.run({ organizationId, projectId, input: ctx.req.valid('json') });
      await notifyImportCompleted(projectId, user.id, 'Ghost', summary);
      return ctx.json({ data: summary }, 200);
    },
  );

export default app;
