import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

// The projects module mounts these at the top level, so the project id arrives
// as `:id` (not `:projectId`) — point the project-org guards at that param.
const projectsRoutes = {
  list: createRouteConfig({
    guard: isAuthenticated,
    tags: ['projects'],
    description: 'List every documentation site the user can access.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  create: createRouteConfig({
    // Any signed-in user can start a new site; they become its owner.
    guard: isAuthenticated,
    tags: ['projects'],
    description: 'Create a documentation site.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  get: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember('id')],
    tags: ['projects'],
    description: 'Retrieve a documentation site.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  update: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN, 'id')],
    tags: ['projects'],
    description: 'Update a documentation site.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  remove: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN, 'id')],
    tags: ['projects'],
    description: 'Delete a documentation site.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default projectsRoutes;
