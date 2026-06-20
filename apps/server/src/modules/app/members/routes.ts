import { MemberRole } from '@plume/shared/constants';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireRole } from '@/middlewares/guard';

const ok = { 200: { description: 'ok' }, ...errorResponses };
const admin = [isAuthenticated, requireRole(MemberRole.ADMIN)] as const;

const membersRoutes = {
  list: createRouteConfig({ guard: isAuthenticated, tags: ['members'], description: 'List members and pending invitations.', responses: ok }),
  invite: createRouteConfig({ guard: [...admin], tags: ['members'], description: 'Invite a member by email.', responses: { 201: { description: 'created' }, ...errorResponses } }),
  updateRole: createRouteConfig({ guard: [...admin], tags: ['members'], description: 'Change a member\'s role.', responses: ok }),
  remove: createRouteConfig({ guard: [...admin], tags: ['members'], description: 'Remove a member.', responses: ok }),
  cancelInvite: createRouteConfig({ guard: [...admin], tags: ['members'], description: 'Cancel a pending invitation.', responses: ok }),
};

export default membersRoutes;
