import { aiDraftBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { draftContent } from '@/actions/ai';
import { assertProjectInOrg } from '@/actions/projects';
import { assertAiQuota } from '@/lib/ai-quota';
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
  const { organizationId } = await scope(ctx);
  // Per-workspace daily budget — the only endpoint with per-request platform
  // spend. Throws 429 when exhausted; no-ops when running on the offline fallback.
  await assertAiQuota(organizationId);
  return ctx.json({ data: await draftContent(ctx.req.valid('json')) }, 200);
});

export default app;
