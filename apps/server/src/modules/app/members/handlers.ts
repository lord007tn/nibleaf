import { inviteMemberBody, updateMemberRoleBody } from '@midad/validators';
import { Hono } from 'hono';
import { cancelInvitation, inviteMember, listMembers, removeMember, updateMemberRole } from '@/actions/members';
import { getContextMembershipOrThrow, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import membersRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...membersRoutes.list, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await listMembers(organizationId) }, 200);
  })
  .post('/invite', ...membersRoutes.invite, validator('json', inviteMemberBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    const { role } = getContextMembershipOrThrow();
    return ctx.json({ data: await inviteMember(organizationId, user.id, role, ctx.req.valid('json')) }, 201);
  })
  .patch('/:id/role', ...membersRoutes.updateRole, validator('json', updateMemberRoleBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const { role } = getContextMembershipOrThrow();
    return ctx.json({ data: await updateMemberRole(organizationId, ctx.req.param('id'), role, ctx.req.valid('json')) }, 200);
  })
  .delete('/:id', ...membersRoutes.remove, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const { role } = getContextMembershipOrThrow();
    return ctx.json({ data: await removeMember(organizationId, ctx.req.param('id'), role) }, 200);
  })
  .delete('/invitations/:id', ...membersRoutes.cancelInvite, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await cancelInvitation(organizationId, ctx.req.param('id')) }, 200);
  });

export default app;
