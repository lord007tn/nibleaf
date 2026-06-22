import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const member = [isAuthenticated, requireProjectMember()] as const;

const deploymentsRoutes = {
  list: createRouteConfig({ guard: [...member], tags: ['deployments'], description: 'List deployments for a project.', responses: ok }),
  latest: createRouteConfig({ guard: [...member], tags: ['deployments'], description: 'Get the latest READY deployment.', responses: ok }),
  publish: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.MEMBER)],
    tags: ['deployments'],
    description: 'Publish the current docs (creates a deployment).',
    responses: { 201: { description: 'queued' }, ...errorResponses },
  }),
  rollback: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.MEMBER)],
    tags: ['deployments'],
    description: 'Roll back to a previous deployment (creates a new one).',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  get: createRouteConfig({ guard: [...member], tags: ['deployments'], description: 'Get a deployment.', responses: ok }),
};

export default deploymentsRoutes;
