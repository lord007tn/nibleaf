import { aiDraftBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { aiDraftAvailable, draftContentWithTelemetry } from '@/actions/ai';
import { trackProjectEvent } from '@/actions/analytics';
import { assertProjectInOrg } from '@/actions/projects';
import { env } from '@/env';
import { AppError } from '@/errors';
import { assertAiQuota } from '@/lib/ai-quota';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import aiRoutes from './routes';

const app = new Hono<HonoEnv>().post('/', ...aiRoutes.draft, validator('json', aiDraftBody), async (ctx) => {
  if (!aiDraftAvailable()) {
    throw new AppError({ code: 'http:not_found', message: 'AI drafting is not configured for this instance.' });
  }
  const organizationId = getContextOrganizationIdOrThrow();
  const projectId = z.string().parse(ctx.req.param('projectId'));
  await assertProjectInOrg(organizationId, projectId);
  // Per-workspace daily budget — the only endpoint with per-request platform
  // spend. Throws 429 when exhausted.
  await assertAiQuota(organizationId);
  await trackProjectEvent(projectId, { name: 'answer_started', provider: 'unknown', model: 'unknown' }, { source: 'dashboard' }).catch(
    () => undefined,
  );
  const started = performance.now();
  let result: Awaited<ReturnType<typeof draftContentWithTelemetry>>;
  try {
    result = await draftContentWithTelemetry(ctx.req.valid('json'));
  } catch (cause) {
    await trackProjectEvent(
      projectId,
      {
        name: 'answer_failed',
        provider: 'openrouter',
        model: env.AI_DRAFT_MODEL,
        latencyMs: Math.round(performance.now() - started),
        noAnswerReason: 'provider_error',
      },
      { source: 'dashboard' },
    ).catch(() => undefined);
    throw new AppError({ code: 'ai:provider_response', message: 'Could not draft content. Try again later.', cause });
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
