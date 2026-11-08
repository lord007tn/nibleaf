import { completeWorkspaceText, resolveWorkspaceAiConfiguration, type WorkspaceAiRuntime } from '@nibleaf/search/workspace';
import type { AiDraftBody } from '@nibleaf/validators';
import { env } from '@/env';
import { AppError } from '@/errors';
import { draftMessages } from '@/lib/ai-draft-prompt';
import { isAiQuotaExhausted } from '@/lib/ai-quota';
import { envExtras } from '@/lib/env-extras';

export interface AiDraftRuntime extends WorkspaceAiRuntime {
  source: 'workspace' | 'instance';
}

/** Resolve once per request so capability and drafting agree on connection policy. */
export const resolveAiDraft = async (projectId: string) => {
  if (envExtras.AI_DAILY_LIMIT === 0) return { runtime: null, reason: 'instance_disabled' as const };
  const resolved = await resolveWorkspaceAiConfiguration(projectId, { instanceFallback: true, textOnly: true });
  if (!resolved.runtime) return { runtime: null, reason: resolved.reason === 'disabled' ? ('site_disabled' as const) : resolved.reason };
  const source = resolved.runtime.revision === 'instance' ? ('instance' as const) : ('workspace' as const);
  return {
    runtime: { ...resolved.runtime, source, answerModel: source === 'instance' ? env.AI_DRAFT_MODEL : resolved.runtime.answerModel },
    reason: null,
  };
};

export interface AiDraftCapability {
  available: boolean;
  source: AiDraftRuntime['source'] | null;
  provider: AiDraftRuntime['providerId'] | null;
  reason: 'not_configured' | 'site_disabled' | 'instance_disabled' | 'quota' | 'quota_unavailable' | null;
}

export const getAiDraftCapability = async (projectId: string, organizationId: string): Promise<AiDraftCapability> => {
  const { runtime, reason } = await resolveAiDraft(projectId);
  let quotaReason: AiDraftCapability['reason'] = null;
  if (runtime) {
    try {
      if (await isAiQuotaExhausted(organizationId)) quotaReason = 'quota';
    } catch (error) {
      if (!(error instanceof AppError && error.code === 'usage:unavailable')) throw error;
      quotaReason = 'quota_unavailable';
    }
  }
  return {
    available: Boolean(runtime) && quotaReason === null,
    source: runtime?.source ?? null,
    provider: runtime?.providerId ?? null,
    reason: quotaReason ?? reason,
  };
};

/** Instance-wide flag for public metadata (`publicMeta.ai.draft`): true only with
 * the instance OpenRouter key. Not the editor gate: a site can draft with its own
 * Smart AI connection, so the editor reads `getAiDraftCapability` for its project. */
export const aiDraftAvailable = () => Boolean(env.OPENROUTER_API_KEY) && envExtras.AI_DAILY_LIMIT > 0;

/** Content-free operational metrics identify the actual connection, never its key. */
export const draftContentWithTelemetry = async (body: AiDraftBody, runtime: AiDraftRuntime) => {
  const started = performance.now();
  const result = await completeWorkspaceText(runtime, draftMessages(body), { siteUrl: env.APP_URL, title: env.APP_NAME });
  const text = result.text.trim();
  if (!text) throw new Error('AI provider returned an empty completion.');
  return {
    ...result,
    text,
    source: runtime.source,
    provider: runtime.providerId,
    model: runtime.answerModel,
    latencyMs: Math.round(performance.now() - started),
  };
};
