import { inviteMemberBody, transferOwnershipBody, updateMemberRoleBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { cancelInvitation, inviteMember, listMembers, removeMember, transferOwnership, updateMemberRole } from '@/actions/members';
import { getContextMembershipOrThrow, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import projectMembersRoutes from './routes';

// `organizationId` here is the PROJECT's own org — the guards resolve it from
// `:projectId`, so these reuse the org-scoped member actions unchanged but now
// operate per-site.
const app = new Hono<HonoEnv>()
  .get('/', ...projectMembersRoutes.list, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await listMembers(organizationId) }, 200);
  })
  .post('/invite', ...projectMembersRoutes.invite, validator('json', inviteMemberBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    const { role } = getContextMembershipOrThrow();
    return ctx.json({ data: await inviteMember(organizationId, user.id, role, ctx.req.valid('json')) }, 201);
  })
  .patch('/:id/role', ...projectMembersRoutes.updateRole, validator('json', updateMemberRoleBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const { role } = getContextMembershipOrThrow();
    return ctx.json({ data: await updateMemberRole(organizationId, ctx.req.param('id'), role, ctx.req.valid('json')) }, 200);
  })
  .post('/transfer-owner', ...projectMembersRoutes.transferOwner, validator('json', transferOwnershipBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    return ctx.json({ data: await transferOwnership(organizationId, user.id, ctx.req.valid('json').memberId) }, 200);
  })
  .delete('/:id', ...projectMembersRoutes.remove, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const { role } = getContextMembershipOrThrow();
    return ctx.json({ data: await removeMember(organizationId, ctx.req.param('id'), role) }, 200);
  })
  .delete('/invitations/:id', ...projectMembersRoutes.cancelInvite, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await cancelInvitation(organizationId, ctx.req.param('id')) }, 200);
  });

export default app;
