import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const passthrough = (_: unknown, next: () => Promise<void>) => next();

const joinPreviewRoutes = {
  preview: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'What a join link offers (site name, role, domain rule). One 404 for every unusable token.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default joinPreviewRoutes;
