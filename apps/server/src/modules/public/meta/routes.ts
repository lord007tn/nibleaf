import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const passthrough = (_: unknown, next: () => Promise<void>) => next();

const metaRoutes = {
  meta: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'Instance metadata for clients: enabled auth providers and whether sign-up is open.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default metaRoutes;
