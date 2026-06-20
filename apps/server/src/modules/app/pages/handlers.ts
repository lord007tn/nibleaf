import { createPageBody, listPagesQuery, reorderPagesBody, updatePageBody } from '@plume/validators';
import { Hono } from 'hono';
import { validator } from 'hono-openapi';
import { assertProjectInOrg } from '@/actions/projects';
import { createPage, deletePage, getPage, listPages, reorderPages, updatePage } from '@/actions/pages';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import pagesRoutes from './routes';

const projectScope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return projectId;
};

const app = new Hono<HonoEnv>()
  .get('/', ...pagesRoutes.list, validator('query', listPagesQuery), async (ctx) => {
    const projectId = await projectScope(ctx);
    const { languageId } = ctx.req.valid('query');
    return ctx.json({ data: await listPages(projectId, languageId) }, 200);
  })
  .post('/', ...pagesRoutes.create, validator('json', createPageBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await createPage(projectId, ctx.req.valid('json')) }, 201);
  })
  .post('/reorder', ...pagesRoutes.reorder, validator('json', reorderPagesBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await reorderPages(projectId, ctx.req.valid('json')) }, 200);
  })
  .get('/:id', ...pagesRoutes.get, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await getPage(projectId, ctx.req.param('id')) }, 200);
  })
  .patch('/:id', ...pagesRoutes.update, validator('json', updatePageBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await updatePage(projectId, ctx.req.param('id'), ctx.req.valid('json')) }, 200);
  })
  .delete('/:id', ...pagesRoutes.remove, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await deletePage(projectId, ctx.req.param('id')) }, 200);
  });

export default app;
