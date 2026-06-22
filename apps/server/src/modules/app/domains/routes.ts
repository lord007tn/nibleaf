import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const admin = [isAuthenticated, requireRole(MemberRole.ADMIN)] as const;

const domainsRoutes = {
  list: createRouteConfig({ guard: isAuthenticated, tags: ['domains'], description: 'List custom domains.', responses: ok }),
  add: createRouteConfig({
    guard: [...admin],
    tags: ['domains'],
    description: 'Connect a custom domain.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  verify: createRouteConfig({ guard: [...admin], tags: ['domains'], description: 'Verify a custom domain.', responses: ok }),
  primary: createRouteConfig({ guard: [...admin], tags: ['domains'], description: 'Set the primary domain.', responses: ok }),
  remove: createRouteConfig({ guard: [...admin], tags: ['domains'], description: 'Disconnect a domain.', responses: ok }),
};

export default domainsRoutes;
