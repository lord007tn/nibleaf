import { randomUUID } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { siteT } from '@nibleaf/i18n/site';
import { createLogger } from '@nibleaf/logger';
import {
  boundChatHistory,
  CHAT_PROMPT_VERSION,
  type ChatUsage,
  citationsToSources,
  condenseFollowUp,
  estimateTokens,
  type GroundedChatResult,
  streamGroundedChat,
  suggestedArticles,
} from '@nibleaf/search';
import { workspaceChatAdapter, workspaceChatModelOptions } from '@nibleaf/search/workspace';
import { defaultLanguage } from '@nibleaf/shared/site';
import {
  AI_CHAT_EVENT,
  type AiChatConsent,
  type AiChatErrorCode,
  type AiChatFinalEvent,
  type AiChatNoAnswerReason,
  type AiConversationTurnStatus,
  type SiteChatBody,
  type SiteChatFeedbackBody,
} from '@nibleaf/validators';
import { EventType, type StreamChunk, toServerSentEventsResponse } from '@tanstack/ai';
import { getContext } from 'hono/context-storage';
import { env } from '@/env';
import { AppError } from '@/errors';
import { recordChatSpend, releaseChatTurn, reserveChatTurn } from '@/lib/ai-search/chat-budget';
import { recordAiChatFeedback, recordAiChatTurn } from '@/lib/ai-search/conversation-archive';
import { chatFeedbackToken, verifyChatFeedbackToken } from '@/lib/ai-search/feedback-token';
import { consumeAnswerQuota } from '@/lib/ai-search/quota';
import { type ChatRetrieval, resolveChatRuntime, retrieveChatContext } from '@/lib/ai-search/runtime';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import { trackProjectEvent } from './analytics';
import { deviceFromUserAgent, resolvePublishedAnswerContext } from './sites';

const log = createLogger({ component: 'ai-chat' });

/** Generic, provider-free messages. Readers see localized copy keyed by `code`. */
const ERROR_MESSAGES: Record<AiChatErrorCode, string> = {
  quota_exhausted: 'This site has reached its daily AI answer quota.',
  rate_limited: 'Too many questions in a short time.',
  conversation_limit: 'This conversation reached its limit. Start a new chat.',
  budget_exhausted: 'This workspace has reached its daily AI budget.',
  unavailable: 'AI answers are temporarily unavailable.',
  invalid_request: 'The question could not be processed.',
  failed: 'The answer could not be completed.',
};

/** Content-free analytics vocabulary (see aiPayload in @nibleaf/clickhouse). */
const ANALYTICS_NO_ANSWER_REASON: Record<AiChatNoAnswerReason, 'low_confidence' | 'policy' | 'unknown'> = {
  low_confidence: 'low_confidence',
  model_declined: 'low_confidence',
  unverified: 'policy',
  empty: 'unknown',
};

type PublishedAnswerContext = Awaited<ReturnType<typeof resolvePublishedAnswerContext>>;

/** Mirrors the reader's consent banner rule (apps/app site-analytics-consent):
 * consent is required only when the banner applies, i.e. consent delivery is on
 * and third-party analytics scripts are configured. */
export const aiChatConsentRequired = (config: unknown): boolean => {
  const value = (config ?? {}) as {
    addons?: { consentBanner?: { enabled?: boolean } };
    analytics?: { cookieConsent?: boolean; ga4?: string; plausible?: string };
  };
  const banner = value.addons?.consentBanner;
  const consentMode = banner ? banner.enabled === true : value.analytics?.cookieConsent === true;
  const ga4 = value.analytics?.ga4?.trim();
  const plausible = value.analytics?.plausible?.trim();
  return consentMode && Boolean((ga4 && /^[\w-]+$/.test(ga4)) || (plausible && /^[\w.-]+$/.test(plausible)));
};

/** The article the reader asked from, if it is a page they may read in the
 * active language/version. Anything else is ignored rather than rejected. */
const resolvePageContext = (context: PublishedAnswerContext, pagePath?: string) => {
  const path = pagePath?.trim().replace(/^\/+|\/+$/g, '');
  if (!path) return;
  const page = context.versionPages.find(
    (candidate) => candidate.kind === 'PAGE' && !candidate.hidden && candidate.languageCode === context.scope.language && candidate.path === path,
  );
  return page ? { id: page.id, title: page.title, path: page.path } : undefined;
};

const usageTokens = (usage?: ChatUsage): number | undefined =>
  usage?.totalTokens ??
  (usage?.inputTokens !== undefined || usage?.outputTokens !== undefined ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : undefined);

const addUsage = (left?: ChatUsage, right?: ChatUsage): ChatUsage | undefined => {
  if (!left) return right;
  if (!right) return left;
  const sum = (a?: number, b?: number) => (a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0));
  return {
    inputTokens: sum(left.inputTokens, right.inputTokens),
    outputTokens: sum(left.outputTokens, right.outputTokens),
    totalTokens: sum(left.totalTokens, right.totalTokens),
    // Cost is only meaningful when every call reported it.
    costUsd: left.costUsd !== undefined && right.costUsd !== undefined ? left.costUsd + right.costUsd : undefined,
  };
};

const custom = (name: string, value: unknown): StreamChunk => ({ type: EventType.CUSTOM, name, value, timestamp: Date.now() });

interface TurnOutcome {
  status: AiConversationTurnStatus;
  noAnswerReason?: AiChatNoAnswerReason;
  answer?: string;
  rewrittenQuery?: string;
  retrieval?: ChatRetrieval;
  result?: GroundedChatResult;
  usage?: ChatUsage;
  errorCode?: AiChatErrorCode;
}

interface ChatTurnInput {
  context: PublishedAnswerContext;
  body: SiteChatBody;
  signal: AbortSignal;
  dimensions: { device: string; country?: string };
}

/** Availability and spend gates, all before any provider call. Any failure to
 * reach the counter store refuses the turn (fail closed, like the answer quota). */
const openChatTurn = async (context: PublishedAnswerContext, conversationId: string) => {
  const projectId = context.scope.projectId;
  if (!context.available) return { ok: false as const, code: 'unavailable' as const };
  const runtime = await resolveChatRuntime(projectId).catch(() => null);
  if (!runtime) return { ok: false as const, code: 'unavailable' as const };
  const reservation = await reserveChatTurn(projectId, conversationId);
  if (!reservation.allowed) return { ok: false as const, code: reservation.reason };
  const quota = await consumeAnswerQuota(projectId).catch(() => null);
  if (!quota?.allowed) {
    await releaseChatTurn(projectId, conversationId).catch(() => undefined);
    return { ok: false as const, code: quota ? ('quota_exhausted' as const) : ('unavailable' as const) };
  }
  return { ok: true as const, runtime, reservation, quota };
};

async function* chatTurnEvents({ context, body, signal, dimensions }: ChatTurnInput): AsyncGenerator<StreamChunk> {
  const projectId = context.scope.projectId;
  const threadId = body.conversationId;
  const runId = randomUUID();
  const turnId = randomUUID();
  const language = context.scope.language;
  const t = siteT(language);
  const fail = (code: AiChatErrorCode): StreamChunk[] => [
    custom(AI_CHAT_EVENT.error, { code }),
    { type: EventType.RUN_ERROR, message: ERROR_MESSAGES[code], code, threadId, runId, timestamp: Date.now() },
  ];

  yield { type: EventType.RUN_STARTED, threadId, runId, timestamp: Date.now() };
  const gate = await openChatTurn(context, body.conversationId).catch(() => ({ ok: false as const, code: 'unavailable' as const }));
  if (!gate.ok) return yield* fail(gate.code);
  const { runtime, reservation, quota } = gate;

  const started = performance.now();
  const analytics = {
    source: 'public_site' as const,
    consentState: body.consent,
    ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    device: dimensions.device,
    ...(dimensions.country ? { country: dimensions.country } : {}),
  };
  void trackProjectEvent(projectId, { name: 'answer_started', provider: runtime.providerId, model: runtime.answerModel }, analytics).catch(
    () => undefined,
  );

  const page = resolvePageContext(context, body.pagePath);
  const outcome: TurnOutcome = { status: 'failed' };
  let textStarted = false;
  try {
    yield custom(AI_CHAT_EVENT.status, { phase: 'searching' });
    const adapter = workspaceChatAdapter(runtime);
    const historyLimits = { maxMessages: envExtras.SEARCH_CHAT_HISTORY_MESSAGES, maxTokens: envExtras.SEARCH_CHAT_HISTORY_MAX_TOKENS };
    const modelOptions = workspaceChatModelOptions(runtime);
    const history = boundChatHistory(body.history, historyLimits);
    const condensed = await condenseFollowUp({ adapter, question: body.question, history, language, signal, historyLimits, modelOptions });
    outcome.usage = condensed.usage;
    outcome.rewrittenQuery = condensed.rewritten ? condensed.query : undefined;
    const retrieval = await retrieveChatContext(context.scope, condensed.query, runtime, { page, signal });
    outcome.retrieval = retrieval;

    yield { type: EventType.TEXT_MESSAGE_START, messageId: turnId, role: 'assistant', timestamp: Date.now() };
    textStarted = true;
    let final: Omit<AiChatFinalEvent, 'conversationId' | 'turnId' | 'feedbackToken' | 'language' | 'limits'>;
    if (retrieval.chunks.length === 0 || retrieval.confidence < env.SEARCH_ANSWER_MIN_CONFIDENCE) {
      // Nothing relevant enough: never let the model improvise.
      const answer = t('noAnswerGrounded');
      yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: turnId, delta: answer, timestamp: Date.now() };
      Object.assign(outcome, { status: 'no_answer', noAnswerReason: 'low_confidence', answer });
      final = {
        status: 'no_answer',
        answer,
        noAnswerReason: 'low_confidence',
        citations: [],
        suggestions: suggestedArticles(retrieval.chunks, condensed.query),
      };
    } else {
      yield custom(AI_CHAT_EVENT.status, { phase: 'writing' });
      const generation = streamGroundedChat({
        adapter,
        model: runtime.answerModel,
        question: body.question,
        history,
        chunks: retrieval.chunks,
        language,
        ...(page ? { pageContext: { title: page.title, path: page.path } } : {}),
        signal,
        historyLimits,
        modelOptions,
      });
      for await (const delta of generation.deltas) {
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: turnId, delta, timestamp: Date.now() };
      }
      yield custom(AI_CHAT_EVENT.status, { phase: 'checking' });
      const result = await generation.result;
      outcome.result = result;
      outcome.usage = addUsage(outcome.usage, result.usage);
      Object.assign(outcome, { status: result.status, noAnswerReason: result.noAnswerReason, answer: result.answer });
      final =
        result.status === 'answered'
          ? { status: 'answered', answer: result.answer, citations: citationsToSources(result.citations), suggestions: [] }
          : {
              status: 'no_answer',
              answer: result.answer,
              noAnswerReason: result.noAnswerReason ?? 'empty',
              citations: [],
              suggestions: suggestedArticles(retrieval.chunks, condensed.query),
            };
    }
    yield { type: EventType.TEXT_MESSAGE_END, messageId: turnId, timestamp: Date.now() };
    textStarted = false;
    yield custom(AI_CHAT_EVENT.final, {
      ...final,
      conversationId: body.conversationId,
      turnId,
      feedbackToken: chatFeedbackToken(projectId, body.conversationId, turnId),
      language,
      limits: { turnsRemaining: reservation.turnsRemaining, quotaRemaining: quota.remaining },
    } satisfies AiChatFinalEvent);
    yield { type: EventType.RUN_FINISHED, threadId, runId, finishReason: 'stop', timestamp: Date.now() };
  } catch (error) {
    if (signal.aborted) {
      outcome.status = 'cancelled';
      return;
    }
    // Provider/retrieval details never reach the reader or the logs' message.
    log.warn({ projectId, phase: outcome.retrieval ? 'generation' : 'retrieval', errorName: (error as Error)?.name }, 'AI chat turn failed');
    outcome.status = 'failed';
    if (textStarted) yield { type: EventType.TEXT_MESSAGE_END, messageId: turnId, timestamp: Date.now() };
    yield* fail('failed');
  } finally {
    // A reader pressing "Stop" ends iteration from outside, skipping catch.
    if (signal.aborted && outcome.status === 'failed') outcome.status = 'cancelled';
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    void finishTurn({ context, body, turnId, turnIndex: reservation.turnIndex, outcome, page, latencyMs, analytics, runtime });
  }
}

/** Book-keeping after the reader has their answer; never blocks or fails the stream. */
const finishTurn = async ({
  context,
  body,
  turnId,
  turnIndex,
  outcome,
  page,
  latencyMs,
  analytics,
  runtime,
}: {
  context: PublishedAnswerContext;
  body: SiteChatBody;
  turnId: string;
  turnIndex: number;
  outcome: TurnOutcome;
  page?: { id: string; title: string; path: string };
  latencyMs: number;
  analytics: Parameters<typeof trackProjectEvent>[2];
  runtime: { providerId: string; answerModel: string };
}): Promise<void> => {
  const projectId = context.scope.projectId;
  const tokens =
    usageTokens(outcome.usage) ??
    // Unknown provider usage still counts against budgets, conservatively.
    estimateTokens(`${body.question}\n${body.history.map((message) => message.content).join('\n')}\n${outcome.answer ?? ''}`) +
      (outcome.retrieval ? outcome.retrieval.chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0) : 0);
  await recordChatSpend(projectId, body.conversationId, tokens).catch(() => log.warn({ projectId }, 'AI chat spend could not be recorded'));

  const usage = outcome.usage;
  const costMicros = usage?.costUsd !== undefined ? Math.round(usage.costUsd * 1_000_000) : undefined;
  const base = { provider: runtime.providerId, model: outcome.result?.model ?? runtime.answerModel, latencyMs };
  const event =
    outcome.status === 'answered' || outcome.status === 'no_answer'
      ? {
          name: 'answer_completed' as const,
          ...base,
          cacheStatus: 'bypass' as const,
          ...(usage?.inputTokens !== undefined ? { promptTokens: usage.inputTokens } : {}),
          ...(usage?.outputTokens !== undefined ? { completionTokens: usage.outputTokens } : {}),
          ...(costMicros !== undefined ? { costMicros } : {}),
          ...(outcome.noAnswerReason ? { noAnswerReason: ANALYTICS_NO_ANSWER_REASON[outcome.noAnswerReason] } : {}),
        }
      : outcome.status === 'cancelled'
        ? { name: 'answer_cancelled' as const, ...base, noAnswerReason: 'cancelled' as const }
        : { name: 'answer_failed' as const, ...base, noAnswerReason: 'provider_error' as const };
  await trackProjectEvent(projectId, event, analytics).catch(() => undefined);

  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } }).catch(() => null);
  if (!project) return;
  const citations = outcome.result?.status === 'answered' ? outcome.result.citations : [];
  const suggestions = outcome.status === 'no_answer' && outcome.retrieval ? suggestedArticles(outcome.retrieval.chunks, body.question) : [];
  await recordAiChatTurn({
    tenantId: project.organizationId,
    projectId,
    conversationId: body.conversationId,
    turnId,
    turnIndex,
    occurredAt: new Date(),
    deploymentId: context.scope.deploymentId,
    versionSlug: context.scope.versionSlug,
    language: context.scope.language,
    visibility: context.scope.visibility,
    consent: body.consent,
    consentRequired: aiChatConsentRequired(context.snapshot.project.config),
    captureSetting: context.request.configuration.aiConversationCapture,
    ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    ...(page ? { pagePath: page.path } : {}),
    status: outcome.status,
    ...(outcome.noAnswerReason ? { noAnswerReason: outcome.noAnswerReason } : {}),
    question: body.question,
    ...(outcome.rewrittenQuery ? { rewrittenQuery: outcome.rewrittenQuery } : {}),
    ...(outcome.answer ? { answer: outcome.answer } : {}),
    citations: citations.map((citation) => ({ id: citation.id, pageId: citation.pageId, title: citation.title, path: citation.path })),
    suggestions: suggestions.map((suggestion) => ({ pageId: suggestion.pageId, title: suggestion.title, path: suggestion.path })),
    provider: runtime.providerId,
    model: base.model,
    promptVersion: CHAT_PROMPT_VERSION,
    ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage?.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    latencyMs,
    ...(outcome.result?.firstTokenMs !== undefined ? { firstTokenMs: Math.round(outcome.result.firstTokenMs) } : {}),
    ...(outcome.retrieval ? { retrievalConfidence: outcome.retrieval.confidence, chunkCount: outcome.retrieval.chunks.length } : {}),
  });
};

/** Stream one reader chat turn as AG-UI server-sent events. Publication and
 * reader access are resolved first so unknown/private sites stay 404; every
 * later refusal (quota, budgets, provider) is reported in-band. */
export const chatSite = async (identifier: string, body: SiteChatBody): Promise<Response> => {
  const context = await resolvePublishedAnswerContext(identifier, body.lang, body.version);
  const request = getContext<HonoEnv>().req.raw;
  const abortController = new AbortController();
  request.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  const headers = request.headers;
  const dimensions = {
    device: deviceFromUserAgent(headers.get('user-agent')),
    country: headers.get('cf-ipcountry') ?? headers.get('x-vercel-ip-country') ?? undefined,
  };
  return toServerSentEventsResponse(chatTurnEvents({ context, body, signal: abortController.signal, dimensions }), {
    abortController,
    headers: { 'Cache-Control': 'private, no-store, no-transform', Vary: 'Cookie, Authorization', 'X-Accel-Buffering': 'no' },
  });
};

/** Save (or change, or withdraw) a reader's rating of one answer. */
export const submitSiteChatFeedback = async (identifier: string, body: SiteChatFeedbackBody) => {
  const context = await resolvePublishedAnswerContext(identifier, body.lang);
  const projectId = context.scope.projectId;
  if (!verifyChatFeedbackToken(projectId, body.conversationId, body.turnId, body.token)) {
    throw new AppError({ code: 'http:forbidden', message: 'This answer cannot be rated from here.' });
  }
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!project) throw new AppError({ code: 'http:not_found', message: 'Site not found.' });
  const consent: AiChatConsent = body.consent;
  await recordAiChatFeedback({
    tenantId: project.organizationId,
    projectId,
    conversationId: body.conversationId,
    turnId: body.turnId,
    rating: body.rating,
    ...(body.reason ? { reason: body.reason } : {}),
    ...(body.comment ? { comment: body.comment } : {}),
    language: body.lang ?? defaultLanguage(context.snapshot.project).code,
    consent,
    consentRequired: aiChatConsentRequired(context.snapshot.project.config),
    captureSetting: context.request.configuration.aiConversationCapture,
    visibility: context.scope.visibility,
  });
  if (body.rating) {
    await trackProjectEvent(
      projectId,
      { name: 'feedback_submitted', feedback: body.rating === 'up' ? 'helpful' : 'not_helpful', target: 'answer' },
      { source: 'public_site', consentState: consent },
    ).catch(() => undefined);
  }
  return { saved: true as const };
};
