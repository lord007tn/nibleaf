import { MemberRole } from '@nibleaf/shared/constants';
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
    description: 'Import Markdown pages from the configured public Git repository.',
    responses: ok,
  }),
  gitWebhookSecret: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: 'Generate or rotate the push-to-deploy webhook secret for this site.',
    responses: ok,
  }),
  usage: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['projects'],
    description: "Get a site's usage counters (pages, languages, members, deployments, traffic, storage) for the Usage tab.",
    responses: ok,
  }),
  searchConfiguration: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['projects'],
    description: "Get a site's resolved search configuration.",
    responses: ok,
  }),
  updateSearchConfiguration: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: "Update a site's search configuration.",
    responses: ok,
  }),
  searchIndexDiagnostics: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['projects'],
    description: "Inspect a site's privacy-minimized search index state.",
    responses: ok,
  }),
  createSearchReindex: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: "Queue a differential rebuild of a site's latest published search index.",
    responses: { 202: { description: 'accepted' }, ...errorResponses },
  }),
};

export default projectSettingsRoutes;
