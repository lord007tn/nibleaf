import { randomUUID } from 'node:crypto';
import { prisma } from '@nibleaf/database';
import { siteT } from '@nibleaf/i18n/site';
import { createLogger } from '@nibleaf/logger';
import {
  boundChatHistory,
  CHAT_MIN_SOURCES_TOKENS,
  CHAT_OUTPUT_TOKEN_LIMITS,
  CHAT_PROMPT_VERSION,
  CHAT_SOURCES_HEADROOM_TOKENS,
  type ChatTurnShape,
  type ChatUsage,
  chatCallInputBounds,
  chatCallInputTokens,
  chatSourcesTokens,
  chatTurnReservation,
  citationsToSources,
  condenseFollowUp,
  estimateTokens,
  fitChatContext,
  fitChatSources,
  type GroundedChatResult,
  type SearchChunk,
  streamGroundedChat,
  suggestedArticles,
  suggestFollowUps,
} from '@nibleaf/search';
import { type ChatCostSink, knownChatCost, workspaceChatAdapter, workspaceChatModelOptions } from '@nibleaf/search/workspace';
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
import { z } from 'zod';
import { env } from '@/env';
import { AppError } from '@/errors';
import { type ChatTurnHold, extendChatTurn, releaseChatTurn, reserveChatTurn, settleChatSpend } from '@/lib/ai-search/chat-budget';
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
  /** Usage of the provider calls that reported it, on the answer model. */
  usage?: ChatUsage;
  /** Set when rewriting and suggestions run on a separate utility model: their
   * usage is kept apart so each model's spend is attributed to it. */
  utility?: { model: string; usage?: ChatUsage };
  /** Provider calls that started but never reported usage (stopped, failed, or a
   * provider that omits it): what each probably used, for records flagged as
   * estimates, and the most it could have used (its prompt at its token bound and
   * its output cap), which the budgets are charged. A call leaves this list only
   * once it reports its usage. */
  unreported: Map<ProviderCall, { input: number; output: number; inputBound: number; outputBound: number }>;
  /** The answer text streamed so far, to estimate an interrupted answer. */
  streamed: string;
  /** Sources the answer read (fewer than retrieval found when the context or a
   * budget was full). */
  sourceCount?: number;
  /** From the request to the checked answer reaching the reader: the answer
   * time, without the suggestions that follow it. */
  latencyMs?: number;
  errorCode?: AiChatErrorCode;
  /** From the request to the first visible text. */
  firstTokenMs?: number;
}

const chatHistoryLimits = () => ({ maxMessages: envExtras.SEARCH_CHAT_HISTORY_MESSAGES, maxTokens: envExtras.SEARCH_CHAT_HISTORY_MAX_TOKENS });

/** What a turn's provider calls are built from, to size them before they run. */
export const chatTurnShape = (
  body: Pick<SiteChatBody, 'question' | 'history'>,
  language: string,
  page?: { title: string; path: string },
): ChatTurnShape => ({
  question: body.question,
  history: body.history,
  language,
  historyLimits: chatHistoryLimits(),
  ...(page ? { pageContext: { title: page.title, path: page.path } } : {}),
});

/** One model's share of a turn. `estimated` marks totals that include a call
 * that never reported its usage; such totals carry no cost. */
interface ModelUsage {
  usage: ChatUsage;
  estimated: boolean;
}
const NOTHING_SPENT: ModelUsage = { usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 }, estimated: false };

/** A turn's usage for budgets and records, per model: the answer model's calls,
 * and the utility model's when rewriting and suggestions run on one. Reported
 * calls count exactly, plus an estimate for every call that started without
 * reporting. Each model is judged on its own calls, so one model's missing
 * report never makes the other's usage or cost unknown. A model's cost is known
 * only when every response billed through its sink reported one. */
const turnUsage = (
  outcome: Pick<TurnOutcome, 'usage' | 'utility' | 'unreported'>,
  sinks: { answer: ChatCostSink; utility: ChatCostSink },
): { answer?: ModelUsage; utility?: ModelUsage & { model: string }; chargedTokens: number } => {
  const part = (reported: ChatUsage | undefined, calls: ProviderCall[], sink: ChatCostSink): ModelUsage | undefined => {
    const estimated = calls.some((call) => outcome.unreported.has(call));
    let input = reported?.inputTokens;
    let output = reported?.outputTokens;
    for (const call of calls) {
      const pending = outcome.unreported.get(call);
      if (!pending) continue;
      input = (input ?? 0) + pending.input;
      output = (output ?? 0) + pending.output;
    }
    if (input === undefined && output === undefined && !reported) return;
    if (estimated) return { usage: { inputTokens: input ?? 0, outputTokens: output ?? 0, totalTokens: (input ?? 0) + (output ?? 0) }, estimated };
    // A provider that bills through the sink states cost there; otherwise only
    // an adapter-reported cost for every call counts.
    const { costUsd: reportedCost, ...counts } = reported ?? {};
    const costUsd = sink.calls ? knownChatCost(sink) : reportedCost;
    return { usage: { ...counts, ...(costUsd !== undefined ? { costUsd } : {}) }, estimated };
  };
  const separate = outcome.utility;
  // A turn that made no call on the answer model (nothing relevant was found)
  // cost it nothing, which is known rather than missing.
  const answer =
    part(outcome.usage, separate ? ['generation'] : ['condense', 'generation', 'follow_ups'], sinks.answer) ??
    (sinks.answer.calls ? undefined : NOTHING_SPENT);
  const utility = separate ? part(separate.usage, ['condense', 'follow_ups'], sinks.utility) : undefined;
  // Budgets are charged reported usage, and the most each unreported call could
  // have used, never an estimate that may fall short.
  let chargedTokens = (usageTokens(outcome.usage) ?? 0) + (usageTokens(separate?.usage) ?? 0);
  for (const pending of outcome.unreported.values()) chargedTokens += pending.inputBound + pending.outputBound;
  return {
    ...(answer ? { answer } : {}),
    ...(separate && utility ? { utility: { ...utility, model: separate.model } } : {}),
    chargedTokens,
  };
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
  // Admitted only with room to read a full context too, so a conversation near
  // its cap is told to start over rather than answered from less.
  const reservation = await reserveChatTurn(projectId, conversationId, estimatedTokens, undefined, CHAT_SOURCES_HEADROOM_TOKENS);
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
  const page = resolvePageContext(context, body.pagePath);
  // Sized from the prompts the turn's calls send, so the budgets hold.
  const shape = chatTurnShape(body, language, page);
  const gate = await openChatTurn(context, body.conversationId, chatTurnReservation(shape)).catch(() => ({
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
  // A separate utility model reports its spend apart from the answer model's.
  const utilityCost: ChatCostSink = {};
  const anchored = withSectionAnchors(context);
  const supportUrl = context.request.configuration.aiSupportUrl;
  // Side calls (suggestions) stop with the turn, even when it fails.
  const sideCalls = new AbortController();
  // Suggestions, once started: they follow the checked answer, and the turn is
  // recorded after they settle.
  let suggesting: Promise<{ questions: string[] }> = Promise.resolve({ questions: [] });
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
    // That model's usage and cost are recorded under its own name.
    const configured = runtime.providerId === 'openrouter' ? envExtras.SEARCH_CHAT_UTILITY_MODEL : undefined;
    const utilityModel = configured && configured !== runtime.answerModel ? configured : undefined;
    if (utilityModel) outcome.utility = { model: utilityModel };
    const utilityAdapter = utilityModel ? workspaceChatAdapter({ ...runtime, answerModel: utilityModel }, utilityCost) : adapter;
    const historyLimits = chatHistoryLimits();
    const modelOptions = workspaceChatModelOptions(runtime);
    const history = boundChatHistory(body.history, historyLimits);
    // A first question is not rewritten, so it makes no call here.
    if (history.length)
      outcome.unreported.set('condense', {
        input: chatCallInputTokens(shape).condense,
        output: CHAT_OUTPUT_TOKEN_LIMITS.condense,
        inputBound: chatCallInputBounds(shape).condense,
        outputBound: CHAT_OUTPUT_TOKEN_LIMITS.condense,
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
    if (outcome.utility) outcome.utility.usage = condensed.usage;
    else outcome.usage = condensed.usage;
    outcome.rewrittenQuery = condensed.rewritten ? condensed.query : undefined;
    phase = 'retrieval';
    const retrieval = await retrieveChatContext(context.scope, condensed.query, runtime, { page, signal });
    outcome.retrieval = retrieval;
    // The sources the answer reads: the best matches that fit the context, and
    // only as many as the budgets have room for. The least of them was reserved
    // before the turn ran; reserve what reading the rest adds, or read less.
    let sources: SearchChunk[] = [];
    if (retrieval.chunks.length && retrieval.confidence >= env.SEARCH_ANSWER_MIN_CONFIDENCE) {
      const fitted = fitChatContext(retrieval.chunks);
      const wanted = chatSourcesTokens(shape, fitted) - CHAT_MIN_SOURCES_TOKENS;
      const granted =
        wanted > 0
          ? await extendChatTurn(projectId, body.conversationId, reservation, wanted).catch(() => {
              log.warn({ projectId }, 'AI chat could not reserve its sources; reading the least');
              return 0;
            })
          : 0;
      sources = granted >= wanted ? fitted : fitChatSources(shape, fitted, CHAT_MIN_SOURCES_TOKENS + granted);
    }
    outcome.sourceCount = sources.length;

    yield { type: EventType.TEXT_MESSAGE_START, messageId: turnId, role: 'assistant', timestamp: Date.now() };
    textStarted = true;
    let final: Omit<AiChatFinalEvent, 'conversationId' | 'turnId' | 'feedbackToken' | 'language' | 'limits'>;
    const noAnswer = (answer: string, noAnswerReason: AiChatNoAnswerReason) => ({
      status: 'no_answer' as const,
      answer,
      noAnswerReason,
      citations: [],
      suggestions: anchored(suggestedArticles(retrieval.chunks, condensed.query)),
      ...(supportUrl ? { supportUrl } : {}),
    });
    if (!sources.length) {
      // Nothing relevant enough: never let the model improvise.
      const answer = t('noAnswerGrounded');
      firstText();
      yield { type: EventType.TEXT_MESSAGE_CONTENT, messageId: turnId, delta: answer, timestamp: Date.now() };
      Object.assign(outcome, { status: 'no_answer', noAnswerReason: 'low_confidence', answer });
      final = noAnswer(answer, 'low_confidence');
    } else {
      yield custom(AI_CHAT_EVENT.status, { phase: 'writing' });
      phase = 'generation';
      const expected = chatCallInputTokens(shape, sources);
      const bounds = chatCallInputBounds(shape, sources);
      outcome.unreported.set('generation', {
        input: expected.generation,
        output: CHAT_OUTPUT_TOKEN_LIMITS.answer,
        inputBound: bounds.generation,
        outputBound: CHAT_OUTPUT_TOKEN_LIMITS.answer,
      });
      const generation = streamGroundedChat({
        adapter,
        model: runtime.answerModel,
        question: body.question,
        history,
        chunks: sources,
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
      if (result.status === 'answered') {
        // Suggestions read the checked answer, so they never ask what it already
        // says. The reader gets the answer first; they arrive after it. Their usage
        // counts as soon as they settle, however the turn ends.
        const answer = result.answer;
        outcome.unreported.set('follow_ups', {
          input: chatCallInputTokens(shape, sources, answer).followUps,
          output: CHAT_OUTPUT_TOKEN_LIMITS.followUps,
          inputBound: chatCallInputBounds(shape, sources, answer).followUps,
          outputBound: CHAT_OUTPUT_TOKEN_LIMITS.followUps,
        });
        suggesting = suggestFollowUps({
          adapter: utilityAdapter,
          question: body.question,
          answer,
          chunks: sources,
          language,
          // A slow suggestions call never holds the reader's run open for long.
          signal: AbortSignal.any([sideSignal, AbortSignal.timeout(envExtras.SEARCH_CHAT_SUGGESTIONS_TIMEOUT_MS)]),
          modelOptions,
          asked: history.filter((message) => message.role === 'user').map((message) => message.content),
        }).then((suggestions) => {
          if (suggestions.usage) outcome.unreported.delete('follow_ups');
          if (outcome.utility) outcome.utility.usage = addUsage(outcome.utility.usage, suggestions.usage);
          else outcome.usage = addUsage(outcome.usage, suggestions.usage);
          if (suggestions.failed) void emit([{ name: 'provider_error', conversationId: threadId, turnId, phase: 'follow_ups' }]);
          return suggestions;
        });
      }
    }
    yield { type: EventType.TEXT_MESSAGE_END, messageId: turnId, timestamp: Date.now() };
    textStarted = false;
    outcome.latencyMs = Math.round(performance.now() - started);
    yield custom(AI_CHAT_EVENT.final, {
      ...final,
      conversationId: body.conversationId,
      turnId,
      feedbackToken: chatFeedbackToken(projectId, body.conversationId, turnId),
      language,
      limits: { turnsRemaining: reservation.turnsRemaining, quotaRemaining: quota.remaining },
    } satisfies AiChatFinalEvent);
    const { questions: followUps } = await suggesting;
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
    // An answer cut off mid-stream probably used what it wrote, not its cap (the
    // budgets are still charged its cap).
    const generation = outcome.unreported.get('generation');
    if (generation && outcome.status !== 'answered' && outcome.status !== 'no_answer')
      outcome.unreported.set('generation', {
        ...generation,
        output: Math.min(CHAT_OUTPUT_TOKEN_LIMITS.answer, estimateTokens(outcome.streamed) + 64),
      });
    // The answer time when the reader got a checked answer; otherwise until the turn ended.
    const latencyMs = Math.max(0, outcome.latencyMs ?? Math.round(performance.now() - started));
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
      utilityCost,
      suggesting,
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
  utilityCost,
  suggesting,
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
  utilityCost: ChatCostSink;
  /** Suggestions still settling (stopped with the turn); their usage counts. */
  suggesting: Promise<unknown>;
  tenant: Promise<string | null>;
  emit: EmitChatEvents;
}): Promise<void> => {
  const projectId = context.scope.projectId;
  await Promise.allSettled([suggesting]);
  // Provider-reported spend (OpenRouter) is read from the response bodies.
  await Promise.allSettled([...(cost.pending ?? []), ...(utilityCost.pending ?? [])]);
  const { answer, utility, chargedTokens } = turnUsage(outcome, { answer: cost, utility: utilityCost });
  const usage = answer?.usage;
  // Replaces the reservation with what the turn is charged: reported usage, and
  // the most each unreported call could have used.
  await settleChatSpend(projectId, body.conversationId, reservation, chargedTokens).catch(() =>
    log.warn({ projectId }, 'AI chat spend could not be recorded'),
  );

  // Estimated totals stay out of analytics events, which carry reported facts
  // only, and they report the answer model's usage, the model they name.
  const reported = answer?.estimated ? undefined : usage;
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
    ...(utility
      ? {
          utilityModel: utility.model,
          utilityInputTokens: utility.usage.inputTokens ?? 0,
          utilityOutputTokens: utility.usage.outputTokens ?? 0,
          ...(utility.usage.costUsd !== undefined ? { utilityCostUsd: utility.usage.costUsd } : {}),
          ...(utility.estimated ? { utilityUsageEstimated: true } : {}),
        }
      : {}),
    ...(answer?.estimated ? { usageEstimated: true } : {}),
    latencyMs,
    ...(outcome.firstTokenMs !== undefined ? { firstTokenMs: outcome.firstTokenMs } : {}),
    ...(outcome.retrieval
      ? {
          retrievalConfidence: outcome.retrieval.confidence,
          chunkCount: outcome.sourceCount ?? 0,
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
    // Events need a conversation id: the request's own when it has a valid one,
    // even if the rest of the body is invalid, else a fresh one.
    const requested = z.uuid().safeParse((rawBody as { conversationId?: unknown } | null | undefined)?.conversationId);
    const conversationId = body?.conversationId ?? (requested.success ? requested.data : randomUUID());
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
