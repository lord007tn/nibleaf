import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };

// One-way content imports from other documentation systems (Mintlify, Ghost, …).
// Admin-gated like the Git import — importing rewrites pages and site settings.
const importsRoutes = {
  mintlify: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: 'Import pages and site settings from a public Mintlify GitHub repository (docs.json or mint.json).',
    responses: ok,
  }),
  ghost: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['projects'],
    description: 'Import published posts and pages from a Ghost JSON export.',
    responses: ok,
  }),
};

export default importsRoutes;
