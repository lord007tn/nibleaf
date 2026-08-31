import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated } from '@/middlewares/guard';

const activationEventRoutes = {
  record: createRouteConfig({
    guard: isAuthenticated,
    tags: ['activation'],
    description: 'Record a consented, allowlisted first-publish stage for the signed-in user.',
    responses: { 200: { description: 'recorded' }, ...errorResponses },
  }),
};

export default activationEventRoutes;
