import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated } from '@/middlewares/guard';

const activationEventRoutes = {
  record: createRouteConfig({
    guard: isAuthenticated,
    tags: ['activation'],
    description: 'Record a consented, allowlisted first-publish navigation stage. READY completion is worker-authored.',
    responses: { 200: { description: 'recorded' }, ...errorResponses },
  }),
};

export default activationEventRoutes;
