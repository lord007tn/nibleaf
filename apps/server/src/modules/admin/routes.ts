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
    description: 'Platform overview: user / site / deployment / waitlist counts.',
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
  sites: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'List every documentation site with owner and counts.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  waitlist: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'List Cloud waitlist signups.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
  deleteWaitlist: createRouteConfig({
    guard: adminGuard,
    tags: ['admin'],
    description: 'Delete a Cloud waitlist entry.',
    responses: { 200: { description: 'ok' }, ...errorResponses },
  }),
};

export default adminRoutes;
