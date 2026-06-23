import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

const passthrough = (_: unknown, next: () => Promise<void>) => next();

const invitationsRoutes = {
  info: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'Public metadata for an invitation (email, site name, role, expiry) — used by the accept page and sign-up prefill.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default invitationsRoutes;
