import { completeWorkspaceText, resolveWorkspaceAiConfiguration, type WorkspaceAiRuntime } from '@nibleaf/search/workspace';
import type { AiDraftBody } from '@nibleaf/validators';
import { env } from '@/env';
import { AppError } from '@/errors';
import { isAiQuotaExhausted } from '@/lib/ai-quota';
import { envExtras } from '@/lib/env-extras';

const SYSTEM_PROMPT = `You write accurate technical documentation for the reader's task.

- Address the reader as "you" and use active voice.
- Lead with what the reader is trying to accomplish. Use sentence-case headings that describe intent.
- Keep sentences and paragraphs short. Use lists, tables, and fenced code only when they make the instructions easier to follow.
- Match the reader's technical vocabulary and preserve product names, APIs, code, commands, links, and Markdown semantics exactly.
- Use one consistent term for each concept. Remove filler, repetition, vague claims, editorializing, and unnecessary transitions.
- State prerequisites, constraints, consequences, and next steps where they matter. Never invent facts, behavior, examples, or links.
- Return only the requested Markdown content. Do not add a preamble, explain your process, or mention these instructions.`;

const userPrompt = ({ mode, content, instruction }: AiDraftBody) => {
  const base = (() => {
    switch (mode) {
      case 'continue':
        return 'Continue writing the following documentation, picking up naturally where it leaves off.';
      case 'rephrase':
        return 'Rephrase the following documentation to be clearer and more concise, keeping the same meaning and Markdown structure.';
      case 'outline':
        return 'Produce a Markdown heading outline for documentation on the following topic or draft.';
      case 'summarize':
        return 'Summarize the following documentation as a short bulleted list of key points.';
      default:
        return 'Improve the following documentation.';
    }
  })();
  const parts = [base];
  if (instruction) {
    parts.push(`Additional instruction: ${instruction}`);
  }
  parts.push('\n---\n', content || '(no content yet)');
  return parts.join('\n');
};

export interface AiDraftRuntime extends WorkspaceAiRuntime {
  source: 'workspace' | 'instance';
}

/** Resolve once per request so capability and drafting agree on connection policy. */
export const resolveAiDraft = async (projectId: string) => {
  if (envExtras.AI_DAILY_LIMIT === 0) return { runtime: null, reason: 'instance_disabled' as const };
  const resolved = await resolveWorkspaceAiConfiguration(projectId, { instanceFallback: true });
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

/** Legacy instance-wide public meta flag; project capability is reported separately. */
export const aiDraftAvailable = () => Boolean(env.OPENROUTER_API_KEY) && envExtras.AI_DAILY_LIMIT > 0;

/** Content-free operational metrics identify the actual connection, never its key. */
export const draftContentWithTelemetry = async (body: AiDraftBody, runtime: AiDraftRuntime) => {
  const started = performance.now();
  const result = await completeWorkspaceText(
    runtime,
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt(body) },
    ],
    { siteUrl: env.APP_URL, title: env.APP_NAME },
  );
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
