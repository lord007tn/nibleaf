import { createJoinLinkBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { createJoinLink, listJoinLinks, regenerateJoinLink, revokeJoinLink } from '@/actions/join-links';
import { getContextMembershipOrThrow, getContextOrganizationIdOrThrow, getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import routes from './routes';

// organizationId is the SITE's own org, resolved from :projectId by the guard.
const actor = () => ({ id: getContextUserOrThrow().id, role: getContextMembershipOrThrow().role });

const app = new Hono<HonoEnv>()
  .get('/', ...routes.list, async (ctx) =>
    ctx.json({ data: await listJoinLinks(getContextOrganizationIdOrThrow(), ctx.req.param('projectId')) }, 200),
  )
  .post('/', ...routes.create, validator('json', createJoinLinkBody), async (ctx) =>
    ctx.json({ data: await createJoinLink(getContextOrganizationIdOrThrow(), actor(), ctx.req.valid('json'), ctx.req.param('projectId')) }, 201),
  )
  .post('/:id/revoke', ...routes.revoke, async (ctx) =>
    ctx.json({ data: await revokeJoinLink(getContextOrganizationIdOrThrow(), ctx.req.param('id'), actor(), ctx.req.param('projectId')) }, 200),
  )
  .post('/:id/regenerate', ...routes.regenerate, async (ctx) =>
    ctx.json({ data: await regenerateJoinLink(getContextOrganizationIdOrThrow(), ctx.req.param('id'), actor(), ctx.req.param('projectId')) }, 200),
  );

export default app;
