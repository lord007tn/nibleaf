import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireRole } from '@/middlewares/guard';

const projectsRoutes = {
  list: createRouteConfig({ guard: isAuthenticated, tags: ['projects'], description: 'List documentation sites in the workspace.', responses: { 200: { description: 'ok' }, ...errorResponses } }),
  create: createRouteConfig({ guard: [isAuthenticated, requireRole(MemberRole.ADMIN)], tags: ['projects'], description: 'Create a documentation site.', responses: { 201: { description: 'created' }, ...errorResponses } }),
  get: createRouteConfig({ guard: isAuthenticated, tags: ['projects'], description: 'Retrieve a documentation site.', responses: { 200: { description: 'ok' }, ...errorResponses } }),
  update: createRouteConfig({ guard: [isAuthenticated, requireRole(MemberRole.ADMIN)], tags: ['projects'], description: 'Update a documentation site.', responses: { 200: { description: 'ok' }, ...errorResponses } }),
  remove: createRouteConfig({ guard: [isAuthenticated, requireRole(MemberRole.ADMIN)], tags: ['projects'], description: 'Delete a documentation site.', responses: { 200: { description: 'ok' }, ...errorResponses } }),
};

export default projectsRoutes;
