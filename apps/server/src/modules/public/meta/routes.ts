import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const passthrough = (_: unknown, next: () => Promise<void>) => next();

const metaRoutes = {
  meta: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'Public instance metadata: enabled auth providers, sign-up policy, and optional consent-gated marketing analytics.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default metaRoutes;
