import { inviteMemberBody, transferOwnershipBody, updateMemberRoleBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { cancelInvitation, inviteMember, listMembers, removeMember, transferOwnership, updateMemberRole } from '@/actions/members';
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

// `organizationId` here is the PROJECT's own org — the guards resolve it from
// `:projectId`, so these reuse the org-scoped member actions unchanged but now
// operate per-site.
const app = new Hono<HonoEnv>()
  .get('/', ...projectMembersRoutes.list, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await listMembers(organizationId) }, 200);
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
    return ctx.json({ data: await inviteMember(organizationId, user.id, role, ctx.req.valid('json'), { language: getContextLocale() }) }, 201);
  })
  .patch('/:id/role', ...projectMembersRoutes.updateRole, validator('json', updateMemberRoleBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    return ctx.json({ data: await updateMemberRole(organizationId, ctx.req.param('id'), user.id, ctx.req.valid('json')) }, 200);
  })
  // OWNER-guarded (see routes.transferOwner); the action re-validates and also
  // repairs legacy multi-owner data so the ending state is exactly one owner.
  .post('/transfer-ownership', ...projectMembersRoutes.transferOwner, validator('json', transferOwnershipBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    return ctx.json({ data: await transferOwnership(organizationId, user.id, ctx.req.valid('json').memberId) }, 200);
  })
  .delete('/:id', ...projectMembersRoutes.remove, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const user = getContextUserOrThrow();
    return ctx.json({ data: await removeMember(organizationId, ctx.req.param('id'), user.id) }, 200);
  })
  .delete('/invitations/:id', ...projectMembersRoutes.cancelInvite, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    return ctx.json({ data: await cancelInvitation(organizationId, ctx.req.param('id')) }, 200);
  });

export default app;
