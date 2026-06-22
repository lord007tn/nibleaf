import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };

const commentsRoutes = {
  list: createRouteConfig({ guard: isAuthenticated, tags: ['comments'], description: 'List comments for a project.', responses: ok }),
  create: createRouteConfig({
    guard: [isAuthenticated, requireRole(MemberRole.MEMBER)],
    tags: ['comments'],
    description: 'Create a comment.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  resolve: createRouteConfig({
    guard: [isAuthenticated, requireRole(MemberRole.MEMBER)],
    tags: ['comments'],
    description: 'Resolve or reopen a comment.',
    responses: ok,
  }),
  remove: createRouteConfig({
    guard: [isAuthenticated, requireRole(MemberRole.MEMBER)],
    tags: ['comments'],
    description: 'Delete a comment.',
    responses: ok,
  }),
};

export default commentsRoutes;
