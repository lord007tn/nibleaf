import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated } from '@/middlewares/guard';

const peopleRoutes = {
  list: createRouteConfig({
    // Scoped by the action to the sites the caller administers.
    guard: isAuthenticated,
    tags: ['members'],
    description: 'Everyone on the sites you administer, with their role on each.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default peopleRoutes;
