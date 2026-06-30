import { MemberRole } from '@midad/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const editor = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;

const languagesRoutes = {
  list: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['languages'],
    description: "List a project's languages.",
    responses: ok,
  }),
  create: createRouteConfig({
    guard: [...editor],
    tags: ['languages'],
    description: 'Create a language.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  update: createRouteConfig({ guard: [...editor], tags: ['languages'], description: 'Update a language.', responses: ok }),
  remove: createRouteConfig({ guard: [...editor], tags: ['languages'], description: 'Delete a language (and its pages).', responses: ok }),
};

export default languagesRoutes;
