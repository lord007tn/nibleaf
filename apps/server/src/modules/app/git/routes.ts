import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const accepted = { 202: { description: 'accepted' }, ...errorResponses };

export default {
  status: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['git'],
    description: 'Get redacted repository connection, operation, conflict, PR, preview, and sync status.',
    responses: ok,
  }),
  connect: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['git'],
    description: 'Create or update a two-way GitHub connection. Provider tokens are encrypted and never returned.',
    responses: ok,
  }),
  authorize: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['git'],
    description: 'Verify a GitHub account before repository configuration. The provider token is not persisted by this endpoint.',
    responses: ok,
  }),
  disconnect: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['git'],
    description: 'Disconnect the repository and delete encrypted credentials and sync state.',
    responses: ok,
  }),
  operation: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.MEMBER)],
    tags: ['git'],
    description: 'Queue an idempotent Git push/PR or upstream pull operation.',
    responses: accepted,
  }),
  resolve: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.MEMBER)],
    tags: ['git'],
    description: 'Explicitly resolve one base/ours/theirs conflict and safely retry when all files are resolved.',
    responses: ok,
  }),
  webhookSecret: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['git'],
    description: 'Rotate the encrypted repository webhook secret and return it once.',
    responses: ok,
  }),
};
