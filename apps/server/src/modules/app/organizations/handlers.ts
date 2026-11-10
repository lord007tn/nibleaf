import { MemberRole } from '@nibleaf/shared/constants';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  cancelOrganizationInvitation,
  changeOrganizationJoinLink,
  createOrganizationJoinLink,
  getOrganization,
  inviteOrganizationMembers,
  listOrganizationJoinLinks,
  listOrganizationMembers,
  listOrganizations,
  organizationBySlug,
  removeOrganizationMember,
  replaceOrganizationMemberAccess,
  transferOrganizationOwnership,
  updateOrganization,
  updateOrganizationMember,
} from '@/actions/organizations';
import { getContextLocale, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import { isAuthenticated, requireOrgRole } from '@/middlewares/guard';

const grant = z.object({ projectId: z.string().min(1), role: z.enum(['admin', 'member', 'viewer']) });
const grants = z.array(grant).max(500);
const invitation = z.object({ emails: z.array(z.email()).min(1).max(100), orgRole: z.enum(['admin', 'member']), grants });
const link = z.object({
  orgRole: z.literal('member').default('member'),
  grants: grants.min(1),
  label: z.string().max(100).optional(),
  allowedDomain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/)
    .nullable()
    .optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});
const member = [isAuthenticated, requireOrgRole(MemberRole.MEMBER)] as const;
const admin = [isAuthenticated, requireOrgRole(MemberRole.ADMIN)] as const;
const owner = [isAuthenticated, requireOrgRole(MemberRole.OWNER)] as const;
const userId = () => getContextUserOrThrow().id;

const app = new Hono<HonoEnv>()
  .get('/', isAuthenticated, async (ctx) => ctx.json({ data: await listOrganizations(userId()) }))
  .get('/by-slug/:slug', isAuthenticated, async (ctx) => ctx.json({ data: await organizationBySlug(userId(), ctx.req.param('slug')) }))
  .get('/:organizationId', ...member, async (ctx) => ctx.json({ data: await getOrganization(userId(), ctx.req.param('organizationId')) }))
  .patch(
    '/:organizationId',
    ...admin,
    validator(
      'json',
      z
        .object({
          name: z.string().trim().min(1).max(100).optional(),
          logo: z.url().nullable().optional(),
          slug: z
            .string()
            .min(3)
            .max(80)
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
            .optional(),
        })
        .strict(),
    ),
    async (ctx) => ctx.json({ data: await updateOrganization(ctx.req.param('organizationId'), userId(), ctx.req.valid('json')) }),
  )
  .get('/:organizationId/members', ...admin, async (ctx) => ctx.json({ data: await listOrganizationMembers(ctx.req.param('organizationId')) }))
  .post('/:organizationId/invitations', ...admin, validator('json', invitation), async (ctx) =>
    ctx.json(
      { data: await inviteOrganizationMembers(ctx.req.param('organizationId'), userId(), ctx.req.valid('json'), { language: getContextLocale() }) },
      201,
    ),
  )
  .delete('/:organizationId/invitations/:id', ...admin, async (ctx) =>
    ctx.json({ data: await cancelOrganizationInvitation(ctx.req.param('organizationId'), userId(), ctx.req.param('id')) }),
  )
  .patch(
    '/:organizationId/members/:memberId',
    ...admin,
    validator('json', z.object({ orgRole: z.enum(['admin', 'member']), grants: grants.optional() })),
    async (ctx) =>
      ctx.json({ data: await updateOrganizationMember(ctx.req.param('organizationId'), userId(), ctx.req.param('memberId'), ctx.req.valid('json')) }),
  )
  .put('/:organizationId/members/:memberId/access', ...admin, validator('json', z.object({ grants })), async (ctx) =>
    ctx.json({
      data: await replaceOrganizationMemberAccess(ctx.req.param('organizationId'), userId(), ctx.req.param('memberId'), ctx.req.valid('json').grants),
    }),
  )
  .delete('/:organizationId/members/:memberId', ...admin, async (ctx) =>
    ctx.json({ data: await removeOrganizationMember(ctx.req.param('organizationId'), userId(), ctx.req.param('memberId')) }),
  )
  .post('/:organizationId/leave', ...member, async (ctx) =>
    ctx.json({ data: await removeOrganizationMember(ctx.req.param('organizationId'), userId()) }),
  )
  .post('/:organizationId/transfer-ownership', ...owner, validator('json', z.object({ memberId: z.string().min(1) })), async (ctx) =>
    ctx.json({ data: await transferOrganizationOwnership(ctx.req.param('organizationId'), userId(), ctx.req.valid('json').memberId) }),
  )
  .get('/:organizationId/join-links', ...admin, async (ctx) => ctx.json({ data: await listOrganizationJoinLinks(ctx.req.param('organizationId')) }))
  .post('/:organizationId/join-links', ...admin, validator('json', link), async (ctx) =>
    ctx.json({ data: await createOrganizationJoinLink(ctx.req.param('organizationId'), userId(), ctx.req.valid('json')) }, 201),
  )
  .delete('/:organizationId/join-links/:id', ...admin, async (ctx) =>
    ctx.json({ data: (await changeOrganizationJoinLink(ctx.req.param('organizationId'), userId(), ctx.req.param('id'), false)).link }),
  )
  .post('/:organizationId/join-links/:id/regenerate', ...admin, async (ctx) =>
    ctx.json({ data: await changeOrganizationJoinLink(ctx.req.param('organizationId'), userId(), ctx.req.param('id'), true) }),
  );
export default app;
