import { createApiKeyBody } from '@midad/validators';
import { Hono } from 'hono';
import { createApiKey, listApiKeys, revokeApiKey } from '@/actions/api-keys';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import apiKeysRoutes from './routes';

const scope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return { organizationId, projectId };
};

const app = new Hono<HonoEnv>()
  .get('/', ...apiKeysRoutes.list, async (ctx) => {
    const { projectId } = await scope(ctx);
    return ctx.json({ data: await listApiKeys(projectId) }, 200);
  })
  .post('/', ...apiKeysRoutes.create, validator('json', createApiKeyBody), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await createApiKey(organizationId, projectId, ctx.req.valid('json')) }, 201);
  })
  .delete('/:id', ...apiKeysRoutes.revoke, async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await revokeApiKey(organizationId, projectId, ctx.req.param('id')) }, 200);
  });

export default app;
