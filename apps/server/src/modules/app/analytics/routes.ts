import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated } from '@/middlewares/guard';

const analyticsRoutes = {
  overview: createRouteConfig({
    guard: isAuthenticated,
    tags: ['analytics'],
    description: 'Traffic and search analytics for a project.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default analyticsRoutes;
