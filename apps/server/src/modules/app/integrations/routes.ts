import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };

export default {
  list: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['integrations'],
    description: 'List the typed provider catalog and redacted project connection status.',
    responses: ok,
  }),
  get: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['integrations'],
    description: 'Get one provider manifest and its redacted project connection status.',
    responses: ok,
  }),
  create: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['integrations'],
    description: 'Create an encrypted project webhook connection. Credentials are write-only.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  update: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['integrations'],
    description: 'Update safe provider configuration or explicitly replace its encrypted credential.',
    responses: ok,
  }),
  mutate: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['integrations'],
    description: 'Activate, deactivate, or verify a project integration using optimistic concurrency.',
    responses: ok,
  }),
  confirmation: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['integrations'],
    description: 'Mint a short-lived, one-time, revision-bound delete confirmation from a Better Auth session.',
    responses: ok,
  }),
  remove: createRouteConfig({
    guard: [isAuthenticated, requireProjectRole(MemberRole.ADMIN)],
    tags: ['integrations'],
    description: 'Delete a project connection with a one-time confirmation token.',
    responses: ok,
  }),
};
