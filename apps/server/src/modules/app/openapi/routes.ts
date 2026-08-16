import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };

const openApiRoutes = {
  get: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['openapi'],
    description: 'Get the editable OpenAPI source metadata for a project.',
    responses: ok,
  }),
  write: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['openapi'],
    description: 'Fetch, validate, and save an OpenAPI 3.x document.',
    responses: ok,
  }),
  sync: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['openapi'],
    description: 'Refresh a URL- or repository-backed OpenAPI document.',
    responses: ok,
  }),
  remove: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['openapi'],
    description: 'Remove a project OpenAPI document from future publishes.',
    responses: ok,
  }),
};

export default openApiRoutes;
