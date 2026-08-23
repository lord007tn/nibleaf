import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember } from '@/middlewares/guard';

const analyticsRoutes = {
  overview: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['analytics'],
    description: 'Traffic and search analytics for a project.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  export: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['analytics'],
    description: 'Export content-free analytical events for a project.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default analyticsRoutes;
