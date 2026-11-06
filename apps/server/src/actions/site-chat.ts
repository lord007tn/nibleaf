import { randomUUID } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { siteT } from '@nibleaf/i18n/site';
import { createLogger } from '@nibleaf/logger';
import {
  boundChatHistory,
  CHAT_OUTPUT_TOKEN_LIMITS,
  CHAT_PROMPT_VERSION,
  type ChatUsage,
  citationsToSources,
  condenseFollowUp,
  estimateTokens,
  type GroundedChatResult,
  streamGroundedChat,
  suggestedArticles,
  suggestFollowUps,
} from '@nibleaf/search';
import { type ChatCostSink, workspaceChatAdapter, workspaceChatModelOptions } from '@nibleaf/search/workspace';
import { defaultLanguage, extractHeadings } from '@nibleaf/shared/site';
import {
  AI_CHAT_EVENT,
  type AiChatConsent,
  type AiChatErrorCode,
  type AiChatFinalEvent,
  type AiChatFollowUpsEvent,
  type AiChatNoAnswerReason,
  type AiChatSource,
  type AiConversationTurnStatus,
  type SiteChatBody,
  type SiteChatFeedbackBody,
  siteChatBody,
} from '@nibleaf/validators';
import { EventType, type StreamChunk, toServerSentEventsResponse } from '@tanstack/ai';
import { getContext } from 'hono/context-storage';
import { env } from '@/env';
import { AppError } from '@/errors';
import { type ChatTurnHold, releaseChatTurn, reserveChatTurn, settleChatSpend } from '@/lib/ai-search/chat-budget';
import { aiChatConsentRequired, trustedChatConsent } from '@/lib/ai-search/chat-consent';
import { recordAiChatFeedback, recordAiChatTurn } from '@/lib/ai-search/conversation-archive';
import { chatFeedbackToken, verifyChatFeedbackToken } from '@/lib/ai-search/feedback-token';
import { consumeAnswerQuota } from '@/lib/ai-search/quota';
import { type ChatRetrieval, resolveChatRuntime, retrieveChatContext } from '@/lib/ai-search/runtime';
import { envExtras } from '@/lib/env-extras';
import type { HonoEnv } from '@/lib/hono/context';
import { trackProjectEvent } from './analytics';
import { type AiChatServerEvent, type ChatEventContext, recordAiChatEvents } from './site-chat-events';
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

const headingKey = (text: string) =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Adds the article's own heading id (the same github-slugger ids the reader
 * TOC uses) to each source, so a citation opens the exact section. A heading
 * that cannot be matched leaves the source page-level rather than guessing. */
const withSectionAnchors = (context: PublishedAnswerContext) => {
  const byPage = new Map<string, Map<string, string>>();
  const anchorsFor = (pageId: string) => {
    let anchors = byPage.get(pageId);
    if (!anchors) {
      anchors = new Map();
      const page = context.versionPages.find((candidate) => candidate.id === pageId);
      for (const heading of page ? extractHeadings(page.content) : []) {
        const key = headingKey(heading.text);
        if (key && !anchors.has(key)) anchors.set(key, heading.id);
      }
      byPage.set(pageId, anchors);
    }
    return anchors;
  };
  return (sources: AiChatSource[]): AiChatSource[] =>
    sources.map((source) => {
      const anchor = source.heading ? anchorsFor(source.pageId).get(headingKey(source.heading)) : undefined;
      return anchor && anchor.length <= 200 ? { ...source, anchor } : source;
    });
};

/** Refusal codes that are a quota or budget the reader ran into. */
const QUOTA_KIND: Partial<Record<AiChatErrorCode, Extract<AiChatServerEvent, { name: 'quota_reached' }>['kind']>> = {
  quota_exhausted: 'daily_quota',
  budget_exhausted: 'token_budget',
  conversation_limit: 'conversation_limit',
  rate_limited: 'rate_limited',
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

type ProviderCall = 'condense' | 'generation' | 'follow_ups';

interface TurnOutcome {
  status: AiConversationTurnStatus;
  noAnswerReason?: AiChatNoAnswerReason;
  answer?: string;
  rewrittenQuery?: string;
  retrieval?: ChatRetrieval;
  result?: GroundedChatResult;
  /** Usage of the provider calls that reported it. */
  usage?: ChatUsage;
  /** Provider calls that started but never reported usage (stopped, failed, or a
   * provider that omits it), with conservative estimates. A call leaves this
   * list only once it reports its usage. */
  unreported: Map<ProviderCall, { input: number; output: number }>;
  /** The answer text streamed so far, to estimate an interrupted answer. */
  streamed: string;
  errorCode?: AiChatErrorCode;
  /** From the request to the first visible text. */
  firstTokenMs?: number;
}

/** Room for the retrieved docs a call reads (bounded chunks, not exact). */
const CHAT_CONTEXT_RESERVE_TOKENS = 3000;
/** Instructions around each call's own input. */
const PROMPT_OVERHEAD_TOKENS: Record<ProviderCall, number> = { condense: 80, generation: 500, follow_ups: 150 };
const historyText = (history: SiteChatBody['history']) => history.map((message) => message.content).join('\n');
const chatHistoryLimits = () => ({ maxMessages: envExtras.SEARCH_CHAT_HISTORY_MESSAGES, maxTokens: envExtras.SEARCH_CHAT_HISTORY_MAX_TOKENS });

/** What a turn may spend before it runs, reserved against the budgets: the
 * rewrite and the answer each read the question and history, the answer and the
 * suggestions each read retrieved docs, plus every call's output cap. The
 * reservation is settled against actual usage when the turn ends. */
export const estimateChatTurnTokens = (body: Pick<SiteChatBody, 'question' | 'history'>): number => {
  const conversation = estimateTokens(`${body.question}\n${historyText(boundChatHistory(body.history, chatHistoryLimits()))}`);
  const outputs = CHAT_OUTPUT_TOKEN_LIMITS.condense + CHAT_OUTPUT_TOKEN_LIMITS.followUps + CHAT_OUTPUT_TOKEN_LIMITS.answer;
  return 2 * conversation + 2 * CHAT_CONTEXT_RESERVE_TOKENS + outputs;
};

/** A turn's usage for budgets and records: reported calls exactly, plus an
 * estimate for every call that started without reporting. `estimated` marks
 * totals that are not provider-reported, and their cost as unknown. */
export const turnUsage = (
  outcome: Pick<TurnOutcome, 'usage' | 'unreported'>,
  costUsd?: number,
): { usage?: ChatUsage; tokens: number; estimated: boolean } => {
  if (outcome.unreported.size === 0) {
    const usage = costUsd !== undefined ? { ...outcome.usage, costUsd } : outcome.usage;
    return { ...(usage ? { usage } : {}), tokens: usageTokens(usage) ?? 0, estimated: false };
  }
  let input = outcome.usage?.inputTokens ?? 0;
  let output = outcome.usage?.outputTokens ?? 0;
  for (const call of outcome.unreported.values()) {
    input += call.input;
    output += call.output;
  }
  return { usage: { inputTokens: input, outputTokens: output, totalTokens: input + output }, tokens: input + output, estimated: true };
};

interface ChatTurnInput {
  context: PublishedAnswerContext;
  body: SiteChatBody;
  signal: AbortSignal;
  reader: ReaderDimensions;
}

/** The reader's browser, as the app server forwards it. */
interface ReaderDimensions {
  userAgent?: string;
  device: string;
  country?: string;
}

/** The workspace that owns the project; null skips the conversation archive. */
const tenantOf = (projectId: string): Promise<string | null> =>
  prisma.project.findUnique({ where: { id: projectId }, select: { organizationId: true } }).then(
    (project) => project?.organizationId ?? null,
    () => null,
  );

type EmitChatEvents = (events: AiChatServerEvent[]) => Promise<void>;

/** Content-free chat events for this reader. Never blocks or fails the stream. */
const chatEventRecorder =
  (context: PublishedAnswerContext, reader: ReaderDimensions & { consent: AiChatConsent; sessionId?: string }): EmitChatEvents =>
  (events) => {
    const eventContext: ChatEventContext = {
      consent: reader.consent,
      ...(reader.sessionId ? { sessionId: reader.sessionId } : {}),
      language: context.scope.language,
      ...(reader.userAgent ? { userAgent: reader.userAgent } : {}),
      device: reader.device,
      ...(reader.country ? { country: reader.country } : {}),
    };
    return recordAiChatEvents(context.scope.projectId, eventContext, events);
  };

/** Availability and spend gates, all before any provider call. Any failure to
 * reach the counter store refuses the turn (fail closed, like the answer quota). */
const openChatTurn = async (context: PublishedAnswerContext, conversationId: string, estimatedTokens: number) => {
  const projectId = context.scope.projectId;
  if (!context.available) return { ok: false as const, code: 'unavailable' as const };
  const runtime = await resolveChatRuntime(projectId).catch(() => null);
  if (!runtime) return { ok: false as const, code: 'unavailable' as const };
  const reservation = await reserveChatTurn(projectId, conversationId, estimatedTokens);
  if (!reservation.allowed) return { ok: false as const, code: reservation.reason };
  const quota = await consumeAnswerQuota(projectId).catch(() => null);
  if (!quota?.allowed) {
    await releaseChatTurn(projectId, conversationId, reservation).catch(() => undefined);
    return { ok: false as const, code: quota ? ('quota_exhausted' as const) : ('unavailable' as const) };
  }
  return { ok: true as const, runtime, reservation, quota };
};

async function* chatTurnEvents({ context, body, signal, reader }: ChatTurnInput): AsyncGenerator<StreamChunk> {
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

  const started = performance.now();
  const tenant = tenantOf(projectId);
  // The consent every record of this turn uses: a client cannot claim consent
  // is not required on a site whose banner applies.
  const consent = trustedChatConsent(context.snapshot.project.config, body.consent);
  const emit = chatEventRecorder(context, { ...reader, consent, ...(body.sessionId ? { sessionId: body.sessionId } : {}) });
  yield { type: EventType.RUN_STARTED, threadId, runId, timestamp: Date.now() };
  const gate = await openChatTurn(context, body.conversationId, estimateChatTurnTokens(body)).catch(() => ({
    ok: false as const,
    code: 'unavailable' as const,
  }));
  if (!gate.ok) {
    const kind = QUOTA_KIND[gate.code];
    void emit([
      ...(kind ? [{ name: 'quota_reached' as const, conversationId: threadId, kind }] : []),
      { name: 'answer_completed', conversationId: threadId, turnId, outcome: 'blocked', reason: gate.code },
    ]);
    return yield* fail(gate.code);
  }
  const { runtime, reservation, quota } = gate;
  const page = resolvePageContext(context, body.pagePath);
  void emit([
    {
      name: 'question_asked',
      conversationId: threadId,
      turnId,
      turnIndex: reservation.turnIndex,
      followUp: body.history.length > 0,
      pageContext: Boolean(page),
    },
  ]);

  const analytics = {
    source: 'public_site' as const,
    consentState: consent,
    ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    device: reader.device,
    ...(reader.country ? { country: reader.country } : {}),
    ...(reader.userAgent ? { userAgent: reader.userAgent } : {}),
  };
  void trackProjectEvent(projectId, { name: 'answer_started', provider: runtime.providerId, model: runtime.answerModel }, analytics).catch(
    () => undefined,
  );

  const outcome: TurnOutcome = { status: 'failed', unreported: new Map(), streamed: '' };
  const cost: ChatCostSink = {};
  const anchored = withSectionAnchors(context);
  const supportUrl = context.request.configuration.aiSupportUrl;
  // Side calls (suggestions) stop with the turn, even when it fails.
  const sideCalls = new AbortController();
  const sideSignal = AbortSignal.any([signal, sideCalls.signal]);
  let phase: 'condense' | 'retrieval' | 'generation' = 'condense';
  let textStarted = false;
  const firstText = () => {
    if (outcome.firstTokenMs !== undefined) return;
    outcome.firstTokenMs = Math.round(performance.now() - started);
    void emit([{ name: 'first_token', conversationId: threadId, turnId, ttftMs: outcome.firstTokenMs }]);
  };
  try {
    yield custom(AI_CHAT_EVENT.status, { phase: 'searching' });
    const adapter = workspaceChatAdapter(runtime, cost);
    // Rewriting and suggestions are small tasks; an operator may route them to a
    // cheaper OpenRouter model. Workspace keys on OpenAI keep the answer model.
    const utilityModel = runtime.providerId === 'openrouter' ? envExtras.SEARCH_CHAT_UTILITY_MODEL : undefined;
    const utilityAdapter = utilityModel ? workspaceChatAdapter({ ...runtime, answerModel: utilityModel }, cost) : adapter;
    const historyLimits = chatHistoryLimits();
    const modelOptions = workspaceChatModelOptions(runtime);
    const history = boundChatHistory(body.history, historyLimits);
    const conversationTokens = estimateTokens(`${body.question}\n${historyText(history)}`);
    // A first question is not rewritten, so it makes no call here.
    if (history.length)
      outcome.unreported.set('condense', {
        input: conversationTokens + PROMPT_OVERHEAD_TOKENS.condense,
        output: CHAT_OUTPUT_TOKEN_LIMITS.condense,
      });
    const condensed = await condenseFollowUp({
      adapter: utilityAdapter,
      question: body.question,
      history,
      language,
      signal,
      historyLimits,
      modelOptions,
    });
    if (condensed.failed) void emit([{ name: 'provider_error', conversationId: threadId, turnId, phase: 'condense' }]);
    if (condensed.usage) outcome.unreported.delete('condense');
    outcome.usage = condensed.usage;
    outcome.rewrittenQuery = condensed.rewritten ? condensed.query : undefined;
    phase = 'retrieval';
    const retrieval = await retrieveChatContext(context.scope, condensed.query, runtime, { page, signal });
    outcome.retrieval = retrieval;

    yield { type: EventType.TEXT_MESSAGE_START, messageId: turnId, role: 'assistant', timestamp: Date.now() };
    textStarted = true;
    let final: Omit<AiChatFinalEvent, 'conversationId' | 'turnId' | 'feedbackToken' | 'language' | 'limits'>;
    let followUps: AiChatFollowUpsEvent['questions'] = [];
    const noAnswer = (answer: string, noAnswerReason: AiChatNoAnswerReason) => ({
      status: 'no_answer' as const,
      answer,
      noAnswerReason,
      citations: [],
      suggestions: anchored(suggestedArticles(retrieval.chunks, condensed.query)),
      ...(supportUrl ? { supportUrl } : {}),
    });
    if (retrieval.chunks.length === 0 || retrieval.confidence < env.SEARCH_ANSWER_MIN_CONFIDENCE) {
      // Nothing relevant enough: never let the model improvise.
      const answer = t('noAnswerGrounded');
      firstText();
      yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: turnId, delta: answer, timestamp: Date.now() };
      Object.assign(outcome, { status: 'no_answer', noAnswerReason: 'low_confidence', answer });
      final = noAnswer(answer, 'low_confidence');
    } else {
      yield custom(AI_CHAT_EVENT.status, { phase: 'writing' });
      phase = 'generation';
      // Prepared while the answer streams, so suggestions add no wait.
      outcome.unreported.set('follow_ups', {
        input: estimateTokens(body.question) + PROMPT_OVERHEAD_TOKENS.follow_ups + 12 * 40,
        output: CHAT_OUTPUT_TOKEN_LIMITS.followUps,
      });
      const suggesting = suggestFollowUps({
        adapter: utilityAdapter,
        question: body.question,
        chunks: retrieval.chunks,
        language,
        signal: sideSignal,
        modelOptions,
        asked: history.filter((message) => message.role === 'user').map((message) => message.content),
      });
      outcome.unreported.set('generation', {
        input:
          conversationTokens + PROMPT_OVERHEAD_TOKENS.generation + retrieval.chunks.reduce((sum, chunk) => sum + estimateTokens(chunk.content), 0),
        output: CHAT_OUTPUT_TOKEN_LIMITS.answer,
      });
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
        firstText();
        outcome.streamed += delta;
        yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: turnId, delta, timestamp: Date.now() };
      }
      yield custom(AI_CHAT_EVENT.status, { phase: 'checking' });
      const result = await generation.result;
      outcome.result = result;
      if (result.usage) outcome.unreported.delete('generation');
      outcome.usage = addUsage(outcome.usage, result.usage);
      Object.assign(outcome, { status: result.status, noAnswerReason: result.noAnswerReason, answer: result.answer });
      final =
        result.status === 'answered'
          ? { status: 'answered', answer: result.answer, citations: anchored(citationsToSources(result.citations)), suggestions: [] }
          : noAnswer(result.answer, result.noAnswerReason ?? 'empty');
      const suggested = await suggesting;
      if (suggested.usage) outcome.unreported.delete('follow_ups');
      outcome.usage = addUsage(outcome.usage, suggested.usage);
      if (suggested.failed) void emit([{ name: 'provider_error', conversationId: threadId, turnId, phase: 'follow_ups' }]);
      if (result.status === 'answered') followUps = suggested.questions;
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
    if (followUps.length) yield custom(AI_CHAT_EVENT.followUps, { turnId, questions: followUps } satisfies AiChatFollowUpsEvent);
    yield { type: EventType.RUN_FINISHED, threadId, runId, finishReason: 'stop', timestamp: Date.now() };
  } catch (error) {
    if (signal.aborted) {
      outcome.status = 'cancelled';
      return;
    }
    // Provider/retrieval details never reach the reader or the logs' message.
    log.warn({ projectId, phase, errorName: (error as Error)?.name }, 'AI chat turn failed');
    outcome.status = 'failed';
    void emit([{ name: 'provider_error', conversationId: threadId, turnId, phase }]);
    if (textStarted) yield { type: EventType.TEXT_MESSAGE_END, messageId: turnId, timestamp: Date.now() };
    yield* fail('failed');
  } finally {
    sideCalls.abort();
    // A reader pressing "Stop" ends iteration from outside, skipping catch.
    if (signal.aborted && outcome.status === 'failed') outcome.status = 'cancelled';
    // An answer cut off mid-stream was billed for what it wrote, not its cap.
    const generation = outcome.unreported.get('generation');
    if (generation && outcome.status !== 'answered' && outcome.status !== 'no_answer')
      outcome.unreported.set('generation', {
        ...generation,
        output: Math.min(CHAT_OUTPUT_TOKEN_LIMITS.answer, estimateTokens(outcome.streamed) + 64),
      });
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    void finishTurn({
      context,
      body,
      consent,
      turnId,
      reservation,
      outcome,
      page,
      latencyMs,
      analytics,
      runtime,
      cost,
      tenant,
      emit,
    });
  }
}

/** Book-keeping after the reader has their answer; never blocks or fails the stream. */
const finishTurn = async ({
  context,
  body,
  consent,
  turnId,
  reservation,
  outcome,
  page,
  latencyMs,
  analytics,
  runtime,
  cost,
  tenant,
  emit,
}: {
  context: PublishedAnswerContext;
  body: SiteChatBody;
  consent: AiChatConsent;
  turnId: string;
  reservation: ChatTurnHold & { turnIndex: number };
  outcome: TurnOutcome;
  page?: { id: string; title: string; path: string };
  latencyMs: number;
  analytics: Parameters<typeof trackProjectEvent>[2];
  runtime: { providerId: string; answerModel: string };
  cost: ChatCostSink;
  tenant: Promise<string | null>;
  emit: EmitChatEvents;
}): Promise<void> => {
  const projectId = context.scope.projectId;
  // Provider-reported spend (OpenRouter) is read from the response bodies.
  await Promise.allSettled(cost.pending ?? []);
  const { usage, tokens, estimated } = turnUsage(outcome, cost.costUsd);
  // Replaces the reservation with what the turn spent, estimates included.
  await settleChatSpend(projectId, body.conversationId, reservation, tokens).catch(() =>
    log.warn({ projectId }, 'AI chat spend could not be recorded'),
  );

  // Estimated totals stay out of analytics events, which carry reported facts only.
  const reported = estimated ? undefined : usage;
  const costMicros = reported?.costUsd !== undefined ? Math.round(reported.costUsd * 1_000_000) : undefined;
  const base = { provider: runtime.providerId, model: outcome.result?.model ?? runtime.answerModel, latencyMs };
  const event =
    outcome.status === 'answered' || outcome.status === 'no_answer'
      ? {
          name: 'answer_completed' as const,
          ...base,
          cacheStatus: 'bypass' as const,
          ...(reported?.inputTokens !== undefined ? { promptTokens: reported.inputTokens } : {}),
          ...(reported?.outputTokens !== undefined ? { completionTokens: reported.outputTokens } : {}),
          ...(costMicros !== undefined ? { costMicros } : {}),
          ...(outcome.noAnswerReason ? { noAnswerReason: ANALYTICS_NO_ANSWER_REASON[outcome.noAnswerReason] } : {}),
        }
      : outcome.status === 'cancelled'
        ? { name: 'answer_cancelled' as const, ...base, noAnswerReason: 'cancelled' as const }
        : { name: 'answer_failed' as const, ...base, noAnswerReason: 'provider_error' as const };
  await trackProjectEvent(projectId, event, analytics).catch(() => undefined);
  await emit([
    {
      name: 'answer_completed',
      conversationId: body.conversationId,
      turnId,
      outcome: outcome.status,
      ...(outcome.noAnswerReason ? { reason: outcome.noAnswerReason } : {}),
      provider: runtime.providerId,
      model: base.model,
      ...(reported?.inputTokens !== undefined ? { inputTokens: reported.inputTokens } : {}),
      ...(reported?.outputTokens !== undefined ? { outputTokens: reported.outputTokens } : {}),
      ...(reported?.costUsd !== undefined ? { costUsd: reported.costUsd } : {}),
      latencyMs,
      ...(outcome.retrieval ? { retrievalCacheHit: outcome.retrieval.cacheHit } : {}),
    },
  ]);

  const tenantId = await tenant;
  if (!tenantId) return;
  const citations = outcome.result?.status === 'answered' ? outcome.result.citations : [];
  const suggestions = outcome.status === 'no_answer' && outcome.retrieval ? suggestedArticles(outcome.retrieval.chunks, body.question) : [];
  await recordAiChatTurn({
    tenantId,
    ...(analytics?.userAgent ? { userAgent: analytics.userAgent } : {}),
    projectId,
    conversationId: body.conversationId,
    turnId,
    turnIndex: reservation.turnIndex,
    occurredAt: new Date(),
    deploymentId: context.scope.deploymentId,
    versionSlug: context.scope.versionSlug,
    language: context.scope.language,
    visibility: context.scope.visibility,
    consent,
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
    // Estimates are stored so totals stay close to what was billed, flagged as such.
    ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(usage?.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    ...(estimated ? { usageEstimated: true } : {}),
    latencyMs,
    ...(outcome.firstTokenMs !== undefined ? { firstTokenMs: outcome.firstTokenMs } : {}),
    ...(outcome.retrieval
      ? {
          retrievalConfidence: outcome.retrieval.confidence,
          chunkCount: outcome.retrieval.chunks.length,
          retrievalCacheHit: outcome.retrieval.cacheHit,
        }
      : {}),
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
  return toServerSentEventsResponse(chatTurnEvents({ context, body, signal: abortController.signal, reader: readerDimensions(request.headers) }), {
    abortController,
    headers: { 'Cache-Control': 'private, no-store, no-transform', Vary: 'Cookie, Authorization', 'X-Accel-Buffering': 'no' },
  });
};

/** Records a chat request the per-client rate limit refused before the turn ran,
 * as the dashboard's limit counter expects. Only for a published site the
 * reader may open: unknown or private identifiers are not recorded. The caller
 * records at most once per client and window. Never throws. */
export const recordChatRateLimited = async (identifier: string, rawBody: unknown, headers: Headers): Promise<void> => {
  try {
    const parsed = siteChatBody.safeParse(rawBody);
    const body = parsed.success ? parsed.data : undefined;
    const context = await resolvePublishedAnswerContext(identifier, body?.lang, body?.version);
    const consent = trustedChatConsent(context.snapshot.project.config, body?.consent ?? 'unknown');
    const conversationId = body?.conversationId ?? '';
    const emit = chatEventRecorder(context, { ...readerDimensions(headers), consent, ...(body?.sessionId ? { sessionId: body.sessionId } : {}) });
    await emit([
      { name: 'quota_reached', conversationId, kind: 'rate_limited' },
      { name: 'answer_completed', conversationId, turnId: randomUUID(), outcome: 'blocked', reason: 'rate_limited' },
    ]);
  } catch {
    // Unknown, unpublished or private: nothing to record.
  }
};

/** The reader's browser. The app server forwards its user agent, so actor and
 * device classification describe the reader rather than the proxy. */
export const readerDimensions = (headers: Headers): ReaderDimensions => {
  const userAgent = headers.get('user-agent')?.slice(0, 2048) || undefined;
  const country = headers.get('cf-ipcountry') ?? headers.get('x-vercel-ip-country') ?? undefined;
  return { ...(userAgent ? { userAgent } : {}), device: deviceFromUserAgent(userAgent ?? null), ...(country ? { country } : {}) };
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
  const consent = trustedChatConsent(context.snapshot.project.config, body.consent);
  const language = body.lang ?? defaultLanguage(context.snapshot.project).code;
  await recordAiChatFeedback({
    tenantId: project.organizationId,
    projectId,
    conversationId: body.conversationId,
    turnId: body.turnId,
    rating: body.rating,
    ...(body.reason ? { reason: body.reason } : {}),
    ...(body.comment ? { comment: body.comment } : {}),
    language,
    consent,
    consentRequired: aiChatConsentRequired(context.snapshot.project.config),
    captureSetting: context.request.configuration.aiConversationCapture,
    visibility: context.scope.visibility,
  });
  // A first rating is "given"; changing or withdrawing an earlier one is
  // "changed". A reason or comment added to the same rating, or withdrawing
  // nothing, is not a new rating (the feedback row above still keeps it).
  const changed = body.previousRating != null;
  if ((body.rating || changed) && body.previousRating !== body.rating) {
    const reader = readerDimensions(getContext<HonoEnv>().req.raw.headers);
    await recordAiChatEvents(projectId, { consent, language, ...reader }, [
      {
        name: changed ? 'feedback_changed' : 'feedback_given',
        conversationId: body.conversationId,
        turnId: body.turnId,
        rating: body.rating,
        ...(body.reason ? { reason: body.reason } : {}),
        ...(changed ? { previousRating: body.previousRating } : {}),
      },
    ]);
  }
  if (body.rating) {
    await trackProjectEvent(
      projectId,
      { name: 'feedback_submitted', feedback: body.rating === 'up' ? 'helpful' : 'not_helpful', target: 'answer' },
      { source: 'public_site', consentState: consent },
    ).catch(() => undefined);
  }
  return { saved: true as const };
};
