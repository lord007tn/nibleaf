import { upsertOpenApiBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { deleteOpenApiDocument, getOpenApiDocument, syncOpenApiDocument, upsertOpenApiDocument } from '@/actions/openapi';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import openApiRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...openApiRoutes.get, async (ctx) => {
    const data = await getOpenApiDocument(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '');
    return ctx.json({ data }, 200);
  })
  .put('/', ...openApiRoutes.write, validator('json', upsertOpenApiBody), async (ctx) => {
    const data = await upsertOpenApiDocument(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '', ctx.req.valid('json'));
    return ctx.json({ data }, 200);
  })
  .post('/sync', ...openApiRoutes.sync, async (ctx) => {
    const data = await syncOpenApiDocument(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '');
    return ctx.json({ data }, 200);
  })
  .delete('/', ...openApiRoutes.remove, async (ctx) => {
    const data = await deleteOpenApiDocument(getContextOrganizationIdOrThrow(), ctx.req.param('projectId') ?? '');
    return ctx.json({ data }, 200);
  });

export default app;
