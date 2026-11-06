import type { AnalyticsPayload } from '@nibleaf/clickhouse';
import type { AiChatClientEvent, AiChatConsent, AiChatOutcome, SiteChatEventsBody } from '@nibleaf/validators';
import { trustedChatConsent } from '@/lib/ai-search/chat-consent';
import { trackProjectEvents } from './analytics';
import { resolvePublishedAnswerContext } from './sites';

/** The reader chat event catalog: client events plus the ones only the server sees. */
export type AiChatServerEvent =
  | AiChatClientEvent
  | { name: 'question_asked'; conversationId: string; turnId: string; turnIndex: number; followUp: boolean; pageContext: boolean }
  | { name: 'first_token'; conversationId: string; turnId: string; ttftMs: number }
  | {
      name: 'answer_completed';
      conversationId: string;
      turnId: string;
      outcome: AiChatOutcome;
      reason?: string;
      provider?: string;
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
      latencyMs?: number;
      retrievalCacheHit?: boolean;
    }
  | {
      name: 'feedback_given' | 'feedback_changed';
      conversationId: string;
      turnId: string;
      rating: 'up' | 'down' | null;
      reason?: string;
      previousRating?: 'up' | 'down' | null;
    }
  | { name: 'quota_reached'; conversationId: string; kind: 'daily_quota' | 'token_budget' | 'conversation_limit' | 'rate_limited' }
  | { name: 'provider_error'; conversationId: string; turnId?: string; phase: 'condense' | 'retrieval' | 'generation' | 'follow_ups' };

/** Who asked, as the analytics envelope needs it. Consent must already be trusted. */
export interface ChatEventContext {
  consent: AiChatConsent;
  sessionId?: string;
  language?: string;
  userAgent?: string;
  device?: string;
  country?: string;
}

const feedbackOf = (rating?: 'up' | 'down' | null) => (rating === 'up' ? 'helpful' : rating === 'down' ? 'not_helpful' : undefined);

/** Map one catalog event onto its content-free `chat_*` analytics payload. */
export const chatAnalyticsPayload = (event: AiChatServerEvent, language?: string): AnalyticsPayload => {
  const base = { conversationId: event.conversationId, ...(language ? { language } : {}) };
  switch (event.name) {
    case 'chat_opened':
      return { name: 'chat_opened', ...base, placement: event.source };
    case 'question_asked':
      return {
        name: 'chat_question_asked',
        ...base,
        turnId: event.turnId,
        outcomeReason: event.followUp ? 'follow_up' : 'first_question',
        ...(event.pageContext ? { placement: 'page_context' as const } : {}),
      };
    case 'first_token':
      return { name: 'chat_first_token', ...base, turnId: event.turnId, durationMs: Math.round(event.ttftMs) };
    case 'answer_completed':
      return {
        name: 'chat_answer_completed',
        ...base,
        turnId: event.turnId,
        outcomeReason: event.outcome,
        ...(event.reason ? { noAnswerReason: event.reason } : {}),
        ...(event.provider ? { provider: event.provider } : {}),
        ...(event.model ? { model: event.model } : {}),
        ...(event.latencyMs !== undefined ? { latencyMs: Math.round(event.latencyMs) } : {}),
        ...(event.inputTokens !== undefined ? { promptTokens: event.inputTokens } : {}),
        ...(event.outputTokens !== undefined ? { completionTokens: event.outputTokens } : {}),
        ...(event.costUsd !== undefined ? { costMicros: Math.round(event.costUsd * 1_000_000) } : {}),
        ...(event.retrievalCacheHit !== undefined ? { cacheStatus: event.retrievalCacheHit ? ('hit' as const) : ('miss' as const) } : {}),
      };
    case 'citation_clicked':
      return { name: 'chat_citation_clicked', ...base, turnId: event.turnId, citationId: event.citationId, citationPosition: event.position };
    case 'follow_up_clicked':
      return { name: 'chat_follow_up_clicked', ...base, turnId: event.turnId, resultPosition: event.position };
    case 'copy':
      return { name: 'chat_copy', ...base, turnId: event.turnId };
    case 'stop':
      return { name: 'chat_stop', ...base };
    case 'new_chat':
      return { name: 'chat_new_chat', ...base };
    case 'feedback_given':
    case 'feedback_changed': {
      const feedback = feedbackOf(event.rating);
      const previousFeedback = feedbackOf(event.previousRating);
      return {
        name: event.name === 'feedback_given' ? 'chat_feedback_given' : 'chat_feedback_changed',
        ...base,
        turnId: event.turnId,
        target: 'answer',
        ...(feedback ? { feedback } : {}),
        ...(previousFeedback ? { previousFeedback } : {}),
        ...(event.reason ? { outcomeReason: event.reason } : {}),
      };
    }
    case 'quota_reached':
      return { name: 'chat_quota_reached', ...base, outcomeReason: event.kind };
    case 'provider_error':
      return { name: 'chat_provider_error', ...base, ...(event.turnId ? { turnId: event.turnId } : {}), outcomeReason: event.phase };
    default: {
      const unknown: never = event;
      throw new Error(`Unknown AI chat event ${String((unknown as { name?: unknown }).name)}`);
    }
  }
};

/** Content-free reader chat events, sent through the shared analytics pipeline
 * (actor classification, consent-gated hashes, micro-batched ingestion and
 * outage replay). Never blocks or fails the caller. */
export const recordAiChatEvents = async (projectId: string, context: ChatEventContext, events: AiChatServerEvent[]): Promise<void> => {
  if (!events.length) return;
  await trackProjectEvents(
    projectId,
    events.map((event) => chatAnalyticsPayload(event, context.language)),
    {
      source: 'public_site',
      consentState: context.consent,
      ...(context.sessionId ? { sessionId: context.sessionId } : {}),
      ...(context.userAgent ? { userAgent: context.userAgent } : {}),
      ...(context.device ? { device: context.device } : {}),
      ...(context.country ? { country: context.country } : {}),
    },
  ).catch(() => undefined);
};

/** Reader interaction events from the chat panel. Publication and reader access
 * resolve first, so unknown sites and readers without access to a private site
 * get a 404; events from readers who may read a private site are kept private. */
export const recordSiteChatEvents = async (
  identifier: string,
  body: SiteChatEventsBody,
  request: Pick<ChatEventContext, 'userAgent' | 'device' | 'country'> = {},
) => {
  const context = await resolvePublishedAnswerContext(identifier, body.lang);
  await recordAiChatEvents(
    context.scope.projectId,
    {
      consent: trustedChatConsent(context.snapshot.project.config, body.consent),
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
      language: context.scope.language,
      ...request,
    },
    body.events,
  );
  return { recorded: body.events.length };
};
