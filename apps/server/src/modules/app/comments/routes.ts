import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const member = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;

const commentsRoutes = {
  list: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['comments'],
    description: 'List comments for a project.',
    responses: ok,
  }),
  create: createRouteConfig({
    guard: [...member],
    tags: ['comments'],
    description: 'Create a comment.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  resolve: createRouteConfig({
    guard: [...member],
    tags: ['comments'],
    description: 'Resolve or reopen a comment.',
    responses: ok,
  }),
  remove: createRouteConfig({
    guard: [...member],
    tags: ['comments'],
    description: 'Delete a comment.',
    responses: ok,
  }),
};

export default commentsRoutes;
