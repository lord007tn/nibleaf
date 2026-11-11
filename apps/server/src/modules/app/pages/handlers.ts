import {
  createPageBody,
  listPagesQuery,
  pageHistoryQuery,
  pageHistorySelection,
  reorderPagesBody,
  restorePageHistoryBody,
  updatePageBody,
} from '@nibleaf/validators';
import { Hono } from 'hono';
import { comparePageHistory, listPageHistory, restorePageHistory } from '@/actions/page-history';
import { getPageInboundLinks } from '@/actions/page-inbound-links';
import { deletePage } from '@/actions/page-trash';
import { createPage, getPage, getPageSearchDescription, listPages, pageStructureRevision, reorderPages, updatePage } from '@/actions/pages';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
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
    const { languageId, branchId } = ctx.req.valid('query');
    const pages = await listPages(projectId, languageId, branchId);
    if (!languageId) ctx.header('x-page-structure-revision', pageStructureRevision(pages));
    return ctx.json({ data: pages }, 200);
  })
  .post('/', ...pagesRoutes.create, validator('json', createPageBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    const page = await createPage(projectId, ctx.req.valid('json'), getContextUserOrThrow().id);
    return ctx.json({ data: page }, 201);
  })
  .post('/reorder', ...pagesRoutes.reorder, validator('json', reorderPagesBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await reorderPages(projectId, ctx.req.valid('json')) }, 200);
  })
  .get('/:id', ...pagesRoutes.get, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await getPage(projectId, ctx.req.param('id')) }, 200);
  })
  .get('/:id/search-description', ...pagesRoutes.searchDescription, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await getPageSearchDescription(projectId, ctx.req.param('id')) }, 200);
  })
  .get('/:id/inbound-links', ...pagesRoutes.inboundLinks, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await getPageInboundLinks(projectId, ctx.req.param('id')) }, 200);
  })
  .get('/:id/history', ...pagesRoutes.get, validator('query', pageHistoryQuery), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await listPageHistory(projectId, ctx.req.param('id'), ctx.req.valid('query')) }, 200);
  })
  .get('/:id/history/compare', ...pagesRoutes.get, validator('query', pageHistorySelection), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await comparePageHistory(projectId, ctx.req.param('id'), ctx.req.valid('query')) }, 200);
  })
  .post('/:id/history/restore', ...pagesRoutes.update, validator('json', restorePageHistoryBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await restorePageHistory(projectId, ctx.req.param('id'), ctx.req.valid('json'), getContextUserOrThrow().id) }, 200);
  })
  .patch('/:id', ...pagesRoutes.update, validator('json', updatePageBody), async (ctx) => {
    const projectId = await projectScope(ctx);
    const page = await updatePage(projectId, ctx.req.param('id'), ctx.req.valid('json'), getContextUserOrThrow().id);
    return ctx.json({ data: page }, 200);
  })
  .delete('/:id', ...pagesRoutes.remove, async (ctx) => {
    const projectId = await projectScope(ctx);
    return ctx.json({ data: await deletePage(projectId, ctx.req.param('id'), getContextUserOrThrow().id) }, 200);
  });

export default app;
