import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const member = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;

const apiKeysRoutes = {
  list: createRouteConfig({ guard: [...member], tags: ['api-keys'], description: 'List API keys.', responses: ok }),
  create: createRouteConfig({
    guard: [...member],
    tags: ['api-keys'],
    description: 'Create an API key (secret shown once).',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  rotate: createRouteConfig({
    guard: [...member],
    tags: ['api-keys'],
    description: 'Rotate an API key atomically (new secret shown once).',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  revoke: createRouteConfig({ guard: [...member], tags: ['api-keys'], description: 'Revoke an API key.', responses: ok }),
};

export default apiKeysRoutes;
