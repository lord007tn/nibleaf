import { listPageTrashQuery, restorePageTrashBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { countPageTrash, listPageTrash, purgePageTrashItem, restorePageTrashItem } from '@/actions/page-trash';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import pageTrashRoutes from './routes';

const projectScope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return projectId;
};

const app = new Hono<HonoEnv>()
  .get('/', ...pageTrashRoutes.list, validator('query', listPageTrashQuery), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await listPageTrash(projectId, ctx.req.valid('query').branchId) }, 200);
  })
  .get('/count', ...pageTrashRoutes.count, validator('query', listPageTrashQuery), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await countPageTrash(projectId, ctx.req.valid('query').branchId) }, 200);
  })
  .post('/:id/restore', ...pageTrashRoutes.restore, validator('json', restorePageTrashBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await restorePageTrashItem(projectId, ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
  .delete('/:id', ...pageTrashRoutes.remove, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await purgePageTrashItem(projectId, ctx.req.param('id')) }, 200);
  });

export default app;
