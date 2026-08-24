import { listProjectAddonAuditQuery, mutateProjectAddonBody, updateProjectAddonBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import {
  activateProjectAddon,
  deactivateProjectAddon,
  getProjectAddon,
  listProjectAddonAuditEvents,
  listProjectAddons,
  updateProjectAddon,
} from '@/actions/addons';
import type { HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import routes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...routes.list, async (ctx) => ctx.json({ data: await listProjectAddons(ctx, ctx.req.param('projectId') as string) }, 200))
  .get('/audit', ...routes.audit, validator('query', listProjectAddonAuditQuery), async (ctx) =>
    ctx.json({ data: await listProjectAddonAuditEvents(ctx, ctx.req.param('projectId') as string, ctx.req.valid('query')) }, 200),
  )
  .get('/:addonId', ...routes.get, async (ctx) =>
    ctx.json({ data: await getProjectAddon(ctx, ctx.req.param('projectId') as string, ctx.req.param('addonId')) }, 200),
  )
  .patch('/:addonId', ...routes.update, validator('json', updateProjectAddonBody), async (ctx) =>
    ctx.json({ data: await updateProjectAddon(ctx, ctx.req.param('projectId') as string, ctx.req.param('addonId'), ctx.req.valid('json')) }, 200),
  )
  .post('/:addonId/activate', ...routes.activate, validator('json', mutateProjectAddonBody), async (ctx) =>
    ctx.json({ data: await activateProjectAddon(ctx, ctx.req.param('projectId') as string, ctx.req.param('addonId'), ctx.req.valid('json')) }, 200),
  )
  .post('/:addonId/deactivate', ...routes.deactivate, validator('json', mutateProjectAddonBody), async (ctx) =>
    ctx.json({ data: await deactivateProjectAddon(ctx, ctx.req.param('projectId') as string, ctx.req.param('addonId'), ctx.req.valid('json')) }, 200),
  );

export default app;
