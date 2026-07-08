import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectRole } from '@/middlewares/guard';

const aiRoutes = {
  draft: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.MEMBER)],
    tags: ['ai'],
    description: 'Draft documentation content with the AI assistant.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default aiRoutes;
