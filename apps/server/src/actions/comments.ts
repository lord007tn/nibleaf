import { prisma } from '@plume/database';
import type { CreateCommentBody } from '@plume/validators';
import { notFound } from '@/errors';
import { assertProjectInOrg } from './projects';

const userSelect = { id: true, name: true, image: true } as const;

/** List comments for a project, newest first, optionally filtered by page. */
export const listComments = async (organizationId: string, projectId: string, pageId?: string) => {
  await assertProjectInOrg(organizationId, projectId);
  return prisma.comment.findMany({
    where: { projectId, ...(pageId ? { pageId } : {}) },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: userSelect } },
  });
};

export const createComment = async (organizationId: string, projectId: string, userId: string, body: CreateCommentBody) => {
  await assertProjectInOrg(organizationId, projectId);
  return prisma.comment.create({
    data: {
      projectId,
      userId,
      body: body.body,
      ...(body.pageId ? { pageId: body.pageId } : {}),
    },
    include: { user: { select: userSelect } },
  });
};

const assertCommentInProject = async (projectId: string, id: string) => {
  const comment = await prisma.comment.findFirst({ where: { id, projectId }, select: { id: true } });
  if (!comment) {
    throw notFound('comment', { id });
  }
};

export const resolveComment = async (organizationId: string, projectId: string, id: string, resolved: boolean) => {
  await assertProjectInOrg(organizationId, projectId);
  await assertCommentInProject(projectId, id);
  return prisma.comment.update({
    where: { id },
    data: { resolved },
    include: { user: { select: userSelect } },
  });
};

export const deleteComment = async (organizationId: string, projectId: string, id: string) => {
  await assertProjectInOrg(organizationId, projectId);
  await assertCommentInProject(projectId, id);
  await prisma.comment.delete({ where: { id } });
  return { id };
};
