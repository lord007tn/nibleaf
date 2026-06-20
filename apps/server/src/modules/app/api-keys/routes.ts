import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const admin = [isAuthenticated, requireRole(MemberRole.ADMIN)] as const;

const apiKeysRoutes = {
  list: createRouteConfig({ guard: isAuthenticated, tags: ['api-keys'], description: 'List API keys.', responses: ok }),
  create: createRouteConfig({ guard: [...admin], tags: ['api-keys'], description: 'Create an API key (secret shown once).', responses: { 201: { description: 'created' }, ...errorResponses } }),
  revoke: createRouteConfig({ guard: [...admin], tags: ['api-keys'], description: 'Revoke an API key.', responses: ok }),
};

export default apiKeysRoutes;
