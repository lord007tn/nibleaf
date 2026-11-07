import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';
export default {
  read: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['analytics'],
    description: 'Read project AI conversations.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  remove: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['analytics'],
    description: 'Delete an AI conversation.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};
