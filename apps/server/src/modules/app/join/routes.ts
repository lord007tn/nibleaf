import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated } from '@/middlewares/guard';
import { rateLimit } from '@/middlewares/rate-limit';

// Tokens carry 256 bits, so guessing is hopeless; the limit still keeps a
// signed-in account from hammering the endpoint.
const joinLimit = rateLimit({ windowMs: 60_000, max: 20 });

const joinRoutes = {
  join: createRouteConfig({
    guard: [joinLimit, isAuthenticated],
    tags: ['join-links'],
    description: 'Join the site a join link belongs to, as the signed-in user.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default joinRoutes;
