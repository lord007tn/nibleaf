import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const passthrough = (_: unknown, next: () => Promise<void>) => next();

const domainsRoutes = {
  resolve: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'Resolve a request Host to its project id (custom-domain serving).',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default domainsRoutes;
