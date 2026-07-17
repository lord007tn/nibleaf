import { ghostImportBody, mintlifyImportBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { importers } from '@/actions/importers';
import { badRequest } from '@/errors';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import importsRoutes from './routes';

/** Ghost exports ship the whole site in one JSON document — allow up to 15 MB. */
const GHOST_MAX_BODY_BYTES = 15 * 1024 * 1024;

// organizationId is the PROJECT's own org (resolved from :projectId by the guards),
// mirroring the project-settings module. Mounted under /projects/:projectId/settings/import.
const app = new Hono<HonoEnv>()
  .post('/mintlify', ...importsRoutes.mintlify, validator('json', mintlifyImportBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    // Always present — the module is mounted under /projects/:projectId/settings/import.
    const projectId = ctx.req.param('projectId') ?? '';
    return ctx.json({ data: await importers.mintlify.run({ organizationId, projectId, input: ctx.req.valid('json') }) }, 200);
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
      const projectId = ctx.req.param('projectId') ?? '';
      return ctx.json({ data: await importers.ghost.run({ organizationId, projectId, input: ctx.req.valid('json') }) }, 200);
    },
  );

export default app;
