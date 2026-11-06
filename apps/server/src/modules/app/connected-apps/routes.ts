import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const member = [isAuthenticated, requireProjectRole(MemberRole.MEMBER)] as const;

const connectedAppsRoutes = {
  list: createRouteConfig({
    guard: [...member],
    tags: ['connected-apps'],
    description: 'List AI apps connected to the project with OAuth.',
    responses: ok,
  }),
  revoke: createRouteConfig({
    guard: [...member],
    tags: ['connected-apps'],
    description: 'Disconnect an AI app: revoke its OAuth connection and tokens.',
    responses: ok,
  }),
};

export default connectedAppsRoutes;
