import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };

// Per-site operational settings (plan, integrations, notifications, git) live on
// the site's OWN organization metadata — each website is its own workspace. The
// guards resolve the project's org from `:projectId`.
const projectSettingsRoutes = {
  get: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['projects'],
    description: "Get a site's operational settings (plan, integrations, notifications, git).",
    responses: ok,
  }),
  update: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: "Update a site's operational settings.",
    responses: ok,
  }),
  gitImport: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: 'Import Markdown pages from the configured GitHub repository.',
    responses: ok,
  }),
};

export default projectSettingsRoutes;
