import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const passthrough = (_: unknown, next: () => Promise<void>) => next();

const waitlistRoutes = {
  submit: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'Join the managed Nibleaf Cloud waitlist. Public and idempotent by email.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default waitlistRoutes;
