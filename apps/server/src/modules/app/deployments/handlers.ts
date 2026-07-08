import { createDeploymentBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import {
  createDeployment,
  getDeployment,
  getDeploymentDiff,
  getLatestReadyDeployment,
  getPendingChanges,
  listDeployments,
  rollbackDeployment,
} from '@/actions/deployments';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import deploymentsRoutes from './routes';

const scope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return { organizationId, projectId };
};

const app = new Hono<HonoEnv>()
  .get('/', ...deploymentsRoutes.list, async (ctx) => {
    const { projectId } = await scope(ctx);
    return ctx.json({ data: await listDeployments(projectId) }, 200);
  })
  .get('/latest', ...deploymentsRoutes.latest, async (ctx) => {
    const { projectId } = await scope(ctx);
    return ctx.json({ data: await getLatestReadyDeployment(projectId) }, 200);
  })
  .get('/changes', ...deploymentsRoutes.changes, async (ctx) => {
    const { projectId } = await scope(ctx);
    return ctx.json({ data: await getPendingChanges(projectId) }, 200);
  })
  .get('/:id/diff', ...deploymentsRoutes.diff, async (ctx) => {
    const { projectId } = await scope(ctx);
    return ctx.json({ data: await getDeploymentDiff(projectId, ctx.req.param('id')) }, 200);
  })
  .post('/', ...deploymentsRoutes.publish, validator('json', createDeploymentBody), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    const user = getContextUserOrThrow();
    return ctx.json({ data: await createDeployment(organizationId, projectId, user.id, ctx.req.valid('json')) }, 201);
  })
  .post('/:id/rollback', ...deploymentsRoutes.rollback, async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    const user = getContextUserOrThrow();
    return ctx.json({ data: await rollbackDeployment(organizationId, projectId, ctx.req.param('id'), user.id) }, 201);
  })
  .get('/:id', ...deploymentsRoutes.get, async (ctx) => {
    const { projectId } = await scope(ctx);
    return ctx.json({ data: await getDeployment(projectId, ctx.req.param('id')) }, 200);
  });

export default app;
