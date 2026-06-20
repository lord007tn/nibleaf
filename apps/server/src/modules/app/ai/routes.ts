import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireRole } from '@/middlewares/guard';

const aiRoutes = {
  draft: createRouteConfig({
    guard: [isAuthenticated, requireRole(MemberRole.MEMBER)],
    tags: ['ai'],
    description: 'Draft documentation content with the AI assistant.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default aiRoutes;
