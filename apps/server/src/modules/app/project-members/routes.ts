import { MemberRole } from '@nibleaf/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const admin = [isAuthenticated, requireProjectRole(MemberRole.ADMIN)] as const;

// Per-site members: scoped to the project's OWN organization (resolved from
// `:projectId` by the guards), so each website manages its own people/roles.
const projectMembersRoutes = {
  list: createRouteConfig({
    guard: [isAuthenticated, requireProjectMember()],
    tags: ['members'],
    description: "List a site's members and pending invitations.",
    responses: ok,
  }),
  suggestions: createRouteConfig({
    guard: [...admin],
    tags: ['members'],
    description: "People from the caller's other administered sites whose name or email starts with `q` (invite suggestions).",
    responses: ok,
  }),
  invite: createRouteConfig({
    guard: [...admin],
    tags: ['members'],
    description: 'Invite a member to the site by email.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  updateRole: createRouteConfig({ guard: [...admin], tags: ['members'], description: "Change a site member's role.", responses: ok }),
  remove: createRouteConfig({ guard: [...admin], tags: ['members'], description: 'Remove a member from the site.', responses: ok }),
  cancelInvite: createRouteConfig({ guard: [...admin], tags: ['members'], description: 'Cancel a pending site invitation.', responses: ok }),
  resendInvite: createRouteConfig({
    guard: [...admin],
    tags: ['members'],
    description: 'Send a pending invitation again with a fresh expiry.',
    responses: ok,
  }),
};

export default projectMembersRoutes;
