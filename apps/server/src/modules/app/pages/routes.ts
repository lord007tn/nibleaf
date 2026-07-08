import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const member = [isAuthenticated, requireProjectMember()] as const;
const editor = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;

const pagesRoutes = {
  list: createRouteConfig({ guard: [...member], tags: ['pages'], description: "List a project's page tree.", responses: ok }),
  create: createRouteConfig({
    guard: [...editor],
    tags: ['pages'],
    description: 'Create a page or group.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  get: createRouteConfig({ guard: [...member], tags: ['pages'], description: 'Retrieve a page (with content).', responses: ok }),
  update: createRouteConfig({ guard: [...editor], tags: ['pages'], description: 'Update a page.', responses: ok }),
  remove: createRouteConfig({ guard: [...editor], tags: ['pages'], description: 'Delete a page (and its children).', responses: ok }),
  reorder: createRouteConfig({ guard: [...editor], tags: ['pages'], description: 'Reorder / re-parent pages.', responses: ok }),
};

export default pagesRoutes;
