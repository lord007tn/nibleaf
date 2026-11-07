import { aiDraftBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import { z } from 'zod';
import { draftContentWithTelemetry, getAiDraftCapability, resolveAiDraft } from '@/actions/ai';
import { trackProjectEvent } from '@/actions/analytics';
import { assertProjectInOrg } from '@/actions/projects';
import { AppError } from '@/errors';
import { assertAiQuota } from '@/lib/ai-quota';
import { getContextOrganizationIdOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import aiRoutes from './routes';

const app = new Hono<HonoEnv>()
  .get('/draft-capability', ...aiRoutes.draftCapability, async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const projectId = z.string().parse(ctx.req.param('projectId'));
    await assertProjectInOrg(organizationId, projectId);
    ctx.header('Cache-Control', 'private, no-store');
    return ctx.json({ data: await getAiDraftCapability(projectId, organizationId) }, 200);
  })
  .post('/', ...aiRoutes.draft, validator('json', aiDraftBody), async (ctx) => {
    const organizationId = getContextOrganizationIdOrThrow();
    const projectId = z.string().parse(ctx.req.param('projectId'));
    await assertProjectInOrg(organizationId, projectId);
    const { runtime, reason } = await resolveAiDraft(projectId);
    if (!runtime) throw new AppError({ code: reason === 'disabled' ? 'ai:disabled' : 'ai:not_configured', details: { reason } });
    // Workspace and instance connections share the same daily drafting budget.
    await assertAiQuota(organizationId);
    await trackProjectEvent(
      projectId,
      { name: 'answer_started', provider: runtime.providerId, model: runtime.answerModel, connectionSource: runtime.source },
      { source: 'dashboard' },
    ).catch(() => undefined);
    const started = performance.now();
    let result: Awaited<ReturnType<typeof draftContentWithTelemetry>>;
    try {
      result = await draftContentWithTelemetry(ctx.req.valid('json'), runtime);
    } catch (cause) {
      await trackProjectEvent(
        projectId,
        {
          name: 'answer_failed',
          provider: runtime.providerId,
          model: runtime.answerModel,
          connectionSource: runtime.source,
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
        connectionSource: result.source,
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
