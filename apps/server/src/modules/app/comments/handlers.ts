import { prisma } from '@nibleaf/database';
import { createCommentBody, resolveCommentBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { assertProjectInOrg } from '@/actions/projects';
import { notFound } from '@/errors';
import { getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import commentsRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...commentsRoutes.list, validator('query', z.object({ pageId: z.string().optional() })), async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    await assertProjectInOrg(getContextOrganizationIdOrThrow(), projectId);
    const { pageId } = ctx.req.valid('query');
    const comments = await prisma.comment.findMany({
      where: { projectId, ...(pageId ? { pageId } : {}) },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, image: true } } },
    });
    return ctx.json({ data: comments }, 200);
  })
  .post('/', ...commentsRoutes.create, validator('json', createCommentBody), async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    await assertProjectInOrg(getContextOrganizationIdOrThrow(), projectId);
    const user = getContextUserOrThrow();
    const body = ctx.req.valid('json');
    if (body.pageId && !(await prisma.page.findFirst({ where: { id: body.pageId, projectId }, select: { id: true } }))) {
      throw notFound('page', { id: body.pageId });
    }
    const comment = await prisma.comment.create({
      data: {
        projectId,
        userId: user.id,
        body: body.body,
        ...(body.pageId ? { pageId: body.pageId } : {}),
        ...(body.anchor ? { anchor: body.anchor } : {}),
      },
      include: { user: { select: { id: true, name: true, image: true } } },
    });
    return ctx.json({ data: comment }, 201);
  })
  .patch('/:id', ...commentsRoutes.resolve, validator('json', resolveCommentBody), async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    await assertProjectInOrg(getContextOrganizationIdOrThrow(), projectId);
    const id = z.string().parse(ctx.req.param('id'));
    if (!(await prisma.comment.findFirst({ where: { id, projectId }, select: { id: true } }))) {
      throw notFound('comment', { id });
    }
    const comment = await prisma.comment.update({
      where: { id },
      data: { resolved: ctx.req.valid('json').resolved },
      include: { user: { select: { id: true, name: true, image: true } } },
    });
    return ctx.json({ data: comment }, 200);
  })
  .delete('/:id', ...commentsRoutes.remove, async (ctx) => {
    const projectId = z.string().parse(ctx.req.param('projectId'));
    await assertProjectInOrg(getContextOrganizationIdOrThrow(), projectId);
    const id = z.string().parse(ctx.req.param('id'));
    if (!(await prisma.comment.findFirst({ where: { id, projectId }, select: { id: true } }))) {
      throw notFound('comment', { id });
    }
    await prisma.comment.delete({ where: { id } });
    return ctx.json({ data: { id } }, 200);
  });

export default app;
