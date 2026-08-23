import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };

const routes = {
  list: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['add-ons'],
    description: 'List the first-party add-on catalog and project state.',
    responses: ok,
  }),
  get: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['add-ons'],
    description: 'Get one project add-on.',
    responses: ok,
  }),
  audit: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['add-ons'],
    description: 'List the append-only project add-on audit history.',
    responses: ok,
  }),
  update: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['add-ons'],
    description: 'Replace the validated configuration for one project add-on.',
    responses: ok,
  }),
  activate: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['add-ons'],
    description: 'Activate one available, configured project add-on.',
    responses: ok,
  }),
  deactivate: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['add-ons'],
    description: 'Deactivate one project add-on.',
    responses: ok,
  }),
};

export default routes;
