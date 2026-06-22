import { aiDraftBody } from '@plume/validators';
import { Hono } from 'hono';
import { draftContent } from '@/actions/ai';
import { assertProjectInOrg } from '@/actions/projects';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import aiRoutes from './routes';

const scope = async (ctx: { req: { param: (k: string) => string } }) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = ctx.req.param('projectId');
  await assertProjectInOrg(organizationId, projectId);
  return { organizationId, projectId };
};

const app = new Hono<HonoEnv>().post('/', ...aiRoutes.draft, validator('json', aiDraftBody), async (ctx) => {
  await scope(ctx);
  return ctx.json({ data: await draftContent(ctx.req.valid('json')) }, 200);
});

export default app;
