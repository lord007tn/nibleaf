import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const passthrough = (_: unknown, next: () => Promise<void>) => next();

const assetRoutes = {
  get: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'Stream a stored asset (proxied from object storage; stable public URL).',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default assetRoutes;
