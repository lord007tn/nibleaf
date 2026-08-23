import { aiDraftBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { draftContentWithTelemetry } from '@/actions/ai';
import { trackProjectEvent } from '@/actions/analytics';
import { assertProjectInOrg } from '@/actions/projects';
import { assertAiQuota } from '@/lib/ai-quota';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import aiRoutes from './routes';

const app = new Hono<HonoEnv>().post('/', ...aiRoutes.draft, validator('json', aiDraftBody), async (ctx) => {
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = z.string().parse(ctx.req.param('projectId'));
  await assertProjectInOrg(organizationId, projectId);
  // Per-workspace daily budget — the only endpoint with per-request platform
  // spend. Throws 429 when exhausted; no-ops when running on the offline fallback.
  await assertAiQuota(organizationId);
  await trackProjectEvent(projectId, { name: 'answer_started', provider: 'unknown', model: 'unknown' }, { source: 'dashboard' }).catch(
    () => undefined,
  );
  const result = await draftContentWithTelemetry(ctx.req.valid('json'));
  if (result.outcome === 'fallback') {
    await trackProjectEvent(
      projectId,
      { name: 'answer_failed', provider: 'openai', model: 'gpt-4o-mini', latencyMs: result.latencyMs, noAnswerReason: 'provider_error' },
      { source: 'dashboard' },
    ).catch(() => undefined);
  }
  await trackProjectEvent(
    projectId,
    {
      name: 'answer_completed',
      provider: result.provider,
      model: result.model,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      cacheStatus: 'bypass',
    },
    { source: 'dashboard' },
  ).catch(() => undefined);
  return ctx.json({ data: { text: result.text } }, 200);
});

export default app;
