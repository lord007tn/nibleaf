import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireLegacyProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };

const workspaceRoutes = {
  analytics: createRouteConfig({
    guard: isAuthenticated,
    tags: ['workspace'],
    description: 'Aggregate analytics across all workspace projects.',
    responses: ok,
  }),
  settings: createRouteConfig({
    // Every role down to Viewer may read; getScopedWorkspaceSettings strips the
    // admin-only sections (webhook secret, integrations) below Admin.
    guard: [isAuthenticated, requireLegacyProjectRole(MemberRole.VIEWER)],
    tags: ['workspace'],
    description: 'Get workspace settings.',
    responses: ok,
  }),
  updateSettings: createRouteConfig({
    guard: [isAuthenticated, requireLegacyProjectRole(MemberRole.ADMIN)],
    tags: ['workspace'],
    description: 'Update workspace settings.',
    responses: ok,
  }),
};

export default workspaceRoutes;
