import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };

const deploymentsRoutes = {
  list: createRouteConfig({ guard: isAuthenticated, tags: ['deployments'], description: 'List deployments for a project.', responses: ok }),
  latest: createRouteConfig({ guard: isAuthenticated, tags: ['deployments'], description: 'Get the latest READY deployment.', responses: ok }),
  publish: createRouteConfig({ guard: [isAuthenticated, requireRole(MemberRole.MEMBER)], tags: ['deployments'], description: 'Publish the current docs (creates a deployment).', responses: { 201: { description: 'queued' }, ...errorResponses } }),
  rollback: createRouteConfig({ guard: [isAuthenticated, requireRole(MemberRole.MEMBER)], tags: ['deployments'], description: 'Roll back to a previous deployment (creates a new one).', responses: { 201: { description: 'created' }, ...errorResponses } }),
  get: createRouteConfig({ guard: isAuthenticated, tags: ['deployments'], description: 'Get a deployment.', responses: ok }),
};

export default deploymentsRoutes;
