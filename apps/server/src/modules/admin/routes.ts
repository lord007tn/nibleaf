import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated } from '@/middlewares/guard';
import { isAdmin } from '@/middlewares/guard/is-admin';

// Internal platform-admin surface (apps/admin). Gated by the `admin` platform
// role — NOT org membership; these read/write across every workspace.
const adminGuard = [isAuthenticated, isAdmin];

const adminRoutes = {
  overview: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'Platform overview: customer, site, and deployment counts.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  users: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'List every user with role and workspace count.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  setRole: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'Grant or revoke a user platform admin role.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  suspendUser: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'Suspend a user: blocks sign-in and revokes active sessions.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  unsuspendUser: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'Lift a user suspension.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  sites: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'List every documentation site with owner and counts.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  inviteOrganization: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'Create a site organization and either email its first owner or return a copyable invitation link.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  takedownSite: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'Take a site down for moderation: stops serving and publishing.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  restoreSite: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'Restore a taken-down site.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  funnel: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'Activation funnel: signups -> edited -> published -> ready (last 30 days).',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default adminRoutes;
