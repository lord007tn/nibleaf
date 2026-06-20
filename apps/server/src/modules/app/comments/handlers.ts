import { createCommentBody, resolveCommentBody } from '@plume/validators';
import { Hono } from 'hono';
import { validator } from 'hono-openapi';
import { z } from 'zod';
import { createComment, deleteComment, listComments, resolveComment } from '@/actions/comments';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import commentsRoutes from './routes';

const scope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return { organizationId, projectId };
};

const app = new Hono<HonoEnv>()
  .get('/', ...commentsRoutes.list, validator('query', z.object({ pageId: z.string().optional() })), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    const { pageId } = ctx.req.valid('query');
    return ctx.json({ data: await listComments(organizationId, projectId, pageId) }, 200);
  })
  .post('/', ...commentsRoutes.create, validator('json', createCommentBody), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    const user = getContextUserOrThrow();
    return ctx.json({ data: await createComment(organizationId, projectId, user.id, ctx.req.valid('json')) }, 201);
  })
  .patch('/:id', ...commentsRoutes.resolve, validator('json', resolveCommentBody), async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await resolveComment(organizationId, projectId, ctx.req.param('id'), ctx.req.valid('json').resolved) }, 200);
  })
  .delete('/:id', ...commentsRoutes.remove, async (ctx) => {
    const { organizationId, projectId } = await scope(ctx);
    return ctx.json({ data: await deleteComment(organizationId, projectId, ctx.req.param('id')) }, 200);
  });

export default app;
