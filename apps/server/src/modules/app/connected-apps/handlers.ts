import { Hono } from 'hono';
import { z } from 'zod';
import { listConnectedApps, revokeConnectedApp } from '@/actions/mcp-oauth';
import { getContextMembershipOrThrow, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import connectedAppsRoutes from './routes';

const actor = () => ({ id: getContextUserOrThrow().id, role: getContextMembershipOrThrow().role });

const app = new Hono<HonoEnv>()
  .get('/', ...connectedAppsRoutes.list, async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    return ctx.json({ data: await listConnectedApps(getContextOrganizationIdOrThrow(), projectId, actor()) }, 200);
  })
  .delete('/:id', ...connectedAppsRoutes.revoke, async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    const id = z.string().parse(ctx.req.param('id'));
    return ctx.json({ data: await revokeConnectedApp(getContextOrganizationIdOrThrow(), projectId, id, actor()) }, 200);
  });

export default app;
