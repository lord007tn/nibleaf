import { inviteMemberBody, updateMemberRoleBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { cancelInvitation, inviteMember, listMembers, removeMember, resendInvitation, updateMemberRole } from '@/actions/members';
import { suggestPeopleToInvite } from '@/actions/people';
import {
  getContextLocale,
  getContextMembershipOrThrow,
  getContextOrganizationIdOrThrow,
  getContextUserOrThrow,
  type HonoEnv,
} from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import projectMembersRoutes from './routes';

// Guards resolve the website's organization; mutations also receive its explicit
// projectId and recheck authority while holding the organization lock.
const app = new Hono<HonoEnv>()
  .get('/', ...projectMembersRoutes.list, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await listMembers(organizationId, ctx.req.param('projectId')) }, 200);
  })
  .get('/suggestions', ...projectMembersRoutes.suggestions, validator('query', z.object({ q: z.string().max(100).default('') })), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    return ctx.json({ data: await suggestPeopleToInvite(user.id, organizationId, ctx.req.valid('query').q, ctx.req.param('projectId')) }, 200);
  })
  .post('/invite', ...projectMembersRoutes.invite, validator('json', inviteMemberBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    const { role } = getContextMembershipOrThrow();
    return ctx.json(
      {
        data: await inviteMember(organizationId, user.id, role, ctx.req.valid('json'), {
          language: getContextLocale(),
          projectId: ctx.req.param('projectId'),
        }),
      },
      201,
    );
  })
  .patch('/:id/role', ...projectMembersRoutes.updateRole, validator('json', updateMemberRoleBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    return ctx.json(
      { data: await updateMemberRole(organizationId, ctx.req.param('id'), user.id, ctx.req.valid('json'), ctx.req.param('projectId')) },
      200,
    );
  })
  .delete('/:id', ...projectMembersRoutes.remove, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    return ctx.json({ data: await removeMember(organizationId, ctx.req.param('id'), user.id, ctx.req.param('projectId')) }, 200);
  })
  .post('/invitations/:id/resend', ...projectMembersRoutes.resendInvite, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json(
      {
        data: await resendInvitation(organizationId, ctx.req.param('id'), getContextUserOrThrow().id, ctx.req.param('projectId'), getContextLocale()),
      },
      200,
    );
  })
  .delete('/invitations/:id', ...projectMembersRoutes.cancelInvite, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json(
      { data: await cancelInvitation(organizationId, ctx.req.param('id'), getContextUserOrThrow().id, ctx.req.param('projectId')) },
      200,
    );
  });

export default app;
