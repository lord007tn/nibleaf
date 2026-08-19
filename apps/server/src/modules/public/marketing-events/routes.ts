import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const passthrough = (_: unknown, next: () => Promise<void>) => next();

const marketingEventRoutes = {
  record: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'Record an allowlisted, privacy-safe Nibleaf marketing event.',
    responses: { 200: { description: 'recorded' }, ...errorResponses },
  }),
};

export default marketingEventRoutes;
