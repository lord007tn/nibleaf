import { createApiKeyBody, rotateApiKeyBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { createApiKey, listApiKeys, revokeApiKey, rotateApiKey } from '@/actions/api-keys';
import { env } from '@/env';
import { getContextMembershipOrThrow, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import apiKeysRoutes from './routes';

const actor = () => ({ id: getContextUserOrThrow().id, role: getContextMembershipOrThrow().role });

const app = new Hono<HonoEnv>()
  .get('/', ...apiKeysRoutes.list, async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    return ctx.json(
      {
        data: await listApiKeys(getContextOrganizationIdOrThrow(), projectId, actor()),
        meta: { mcpEnabled: env.MCP_ENABLED, mcpEndpoint: `${env.APP_URL.replace(/\/$/, '')}/api/mcp` },
      },
      200,
    );
  })
  .post('/', ...apiKeysRoutes.create, validator('json', createApiKeyBody), async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    const key = await createApiKey(getContextOrganizationIdOrThrow(), projectId, actor(), ctx.req.valid('json'));
    return ctx.json({ data: key }, 201);
  })
  .post('/:id/rotate', ...apiKeysRoutes.rotate, validator('json', rotateApiKeyBody), async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    const key = await rotateApiKey(
      getContextOrganizationIdOrThrow(),
      projectId,
      z.string().parse(ctx.req.param('id')),
      actor(),
      ctx.req.valid('json'),
    );
    return ctx.json({ data: key }, 201);
  })
  .delete('/:id', ...apiKeysRoutes.revoke, async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    const id = z.string().parse(ctx.req.param('id'));
    return ctx.json({ data: await revokeApiKey(getContextOrganizationIdOrThrow(), projectId, id, actor()) }, 200);
  });

export default app;
