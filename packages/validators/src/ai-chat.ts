import { z } from 'zod';
import { supportActionUrlSchema } from './action-urls';

/**
 * Shared contracts for the published-docs AI assistant: the reader chat wire
 * format, reader feedback, and the workspace dashboard / MCP read models.
 *
 * The chat endpoint streams AG-UI events (TanStack AI). Nibleaf-specific data
 * travels in `CUSTOM` events named by `AI_CHAT_EVENT`; their `value` payloads
 * are validated with the schemas below on both ends.
 */

export const AI_CHAT_LIMITS = {
  questionMin: 2,
  questionMax: 500,
  /** Client-supplied history is bounded again server-side by env limits. */
  historyMessagesMax: 12,
  historyContentMax: 4000,
  feedbackCommentMax: 1000,
  starterQuestionsMax: 4,
  starterQuestionMin: 3,
  starterQuestionMax: 120,
} as const;

/** Mirrors `consentStateSchema` in @nibleaf/clickhouse. `not_required` is only
 * honoured when the server agrees the site has no consent requirement. */
export const aiChatConsentSchema = z.enum(['denied', 'granted', 'not_required', 'unknown']);
export type AiChatConsent = z.infer<typeof aiChatConsentSchema>;

export const aiChatHistoryMessageSchema = z
  .object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(AI_CHAT_LIMITS.historyContentMax),
  })
  .strict();
export type AiChatHistoryMessage = z.infer<typeof aiChatHistoryMessageSchema>;

/** `POST /api/public/sites/:id/chat`. Tenant, deployment and page grants are
 * always derived server-side; the body can only narrow the reader's own scope. */
export const siteChatBody = z
  .object({
    conversationId: z.uuid(),
    question: z.string().trim().min(AI_CHAT_LIMITS.questionMin).max(AI_CHAT_LIMITS.questionMax),
    /** Prior turns, oldest first, excluding `question`. Assistant entries carry
     * the validated final text (or the no-answer text), never raw streamed text. */
    history: z.array(aiChatHistoryMessageSchema).max(AI_CHAT_LIMITS.historyMessagesMax).default([]),
    lang: z.string().trim().min(2).max(35).optional(),
    version: z.string().trim().min(1).max(120).optional(),
    /** Published path of the article the reader asked from ("Ask about this page"). */
    pagePath: z.string().trim().max(512).optional(),
    consent: aiChatConsentSchema.default('unknown'),
    /** Per-tab random id; hashed before storage, never stored raw. */
    sessionId: z.string().trim().min(8).max(128).optional(),
  })
  .strict();
export type SiteChatBody = z.infer<typeof siteChatBody>;

/** Names of the CUSTOM AG-UI events the chat endpoint emits. */
export const AI_CHAT_EVENT = {
  /** Progress hint for plain-language UI copy. Value: `aiChatStatusEventSchema`. */
  status: 'nibleaf.chat.status',
  /** Exactly one per successful run, before RUN_FINISHED. Value: `aiChatFinalEventSchema`. */
  final: 'nibleaf.chat.final',
  /** Exactly one per failed run, before RUN_ERROR. Value: `aiChatErrorEventSchema`. */
  error: 'nibleaf.chat.error',
  /** Optional, after `final` for answered turns. Value: `aiChatFollowUpsEventSchema`. */
  followUps: 'nibleaf.chat.followups',
} as const;

export const aiChatPhaseSchema = z.enum(['searching', 'writing', 'checking']);
export const aiChatStatusEventSchema = z.object({ phase: aiChatPhaseSchema }).strict();
export type AiChatStatusEvent = z.infer<typeof aiChatStatusEventSchema>;

export const aiChatErrorCodeSchema = z.enum([
  /** The site's daily AI answer quota is used up. */
  'quota_exhausted',
  /** Too many requests from this visitor in a short time. */
  'rate_limited',
  /** This conversation reached its turn or token cap; start a new chat. */
  'conversation_limit',
  /** The workspace's daily AI spend budget is used up. */
  'budget_exhausted',
  /** AI answers are off, not ready, or the provider/quota service is down. */
  'unavailable',
  'invalid_request',
  'failed',
]);
export type AiChatErrorCode = z.infer<typeof aiChatErrorCodeSchema>;
export const aiChatErrorEventSchema = z.object({ code: aiChatErrorCodeSchema }).strict();
export type AiChatErrorEvent = z.infer<typeof aiChatErrorEventSchema>;

export const aiChatSourceSchema = z
  .object({
    /** `S1`, `S2`, … for citations (matches inline `[S1]` markers); `P1`, … for suggestions. */
    id: z.string().min(1).max(16),
    pageId: z.string().min(1),
    title: z.string(),
    /** Published page path; the reader builds the href with its lang/version. */
    path: z.string(),
    heading: z.string().optional(),
    snippet: z.string(),
    language: z.string().optional(),
    /** DOM id of the cited section on the published page (github-slugger, as the TOC). */
    anchor: z.string().min(1).max(200).optional(),
    direction: z.enum(['ltr', 'rtl']),
  })
  .strict();
export type AiChatSource = z.infer<typeof aiChatSourceSchema>;

export const aiChatNoAnswerReasonSchema = z.enum([
  /** Retrieval found nothing relevant enough; the model was not called. */
  'low_confidence',
  /** The model said the sources do not answer the question. */
  'model_declined',
  /** The streamed answer failed citation validation and was withdrawn. */
  'unverified',
  'empty',
]);
export type AiChatNoAnswerReason = z.infer<typeof aiChatNoAnswerReasonSchema>;

export const aiChatFinalEventSchema = z
  .object({
    conversationId: z.uuid(),
    /** Stable id of this question/answer turn. Equals the AG-UI assistant
     * `messageId` of the run's TEXT_MESSAGE_* events. */
    turnId: z.uuid(),
    status: z.enum(['answered', 'no_answer']),
    /** The text the reader must see: validated Markdown with `[S#]` markers when
     * answered (it replaces the streamed text), the localized no-answer copy otherwise. */
    answer: z.string(),
    noAnswerReason: aiChatNoAnswerReasonSchema.optional(),
    citations: z.array(aiChatSourceSchema),
    /** Best-matching articles. Always offered for `no_answer`; may be empty. */
    suggestions: z.array(aiChatSourceSchema),
    /** Opaque proof that this reader received this turn; required for feedback. */
    feedbackToken: z.string().min(16).max(256),
    /** Where readers can get help when the docs do not answer (no_answer only). */
    supportUrl: supportActionUrlSchema.optional(),
    language: z.string(),
    limits: z
      .object({
        turnsRemaining: z.number().int().min(0),
        quotaRemaining: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export type AiChatFinalEvent = z.infer<typeof aiChatFinalEventSchema>;

export const aiChatFollowUpsEventSchema = z
  .object({
    turnId: z.uuid(),
    questions: z.array(z.string().trim().min(3).max(120)).max(3),
  })
  .strict();
export type AiChatFollowUpsEvent = z.infer<typeof aiChatFollowUpsEventSchema>;

// ─── Chat event catalog (analytics) ─────────────────────────────────────────

/** Every chat analytics event. Client-reported events are a subset (below);
 * the rest are recorded by the API itself. All are content-free. */
export const aiChatEventNameSchema = z.enum([
  'chat_opened',
  'question_asked',
  'first_token',
  'answer_completed',
  'citation_clicked',
  'follow_up_clicked',
  'copy',
  'stop',
  'new_chat',
  'feedback_given',
  'feedback_changed',
  'quota_reached',
  'provider_error',
]);
export type AiChatEventName = z.infer<typeof aiChatEventNameSchema>;
export const aiChatOpenSourceSchema = z.enum(['launcher', 'page_button', 'search_handoff', 'deep_link']);
export type AiChatOpenSource = z.infer<typeof aiChatOpenSourceSchema>;
/** answered / no_answer as in the final event; blocked = refused before
 * generation (quota, budget, limits, unavailable); failed; cancelled. */
export const aiChatOutcomeSchema = z.enum(['answered', 'no_answer', 'blocked', 'failed', 'cancelled']);
export type AiChatOutcome = z.infer<typeof aiChatOutcomeSchema>;
export const aiChatQuotaKindSchema = z.enum(['daily_quota', 'token_budget', 'conversation_limit', 'rate_limited']);
export const aiChatProviderPhaseSchema = z.enum(['condense', 'retrieval', 'generation', 'follow_ups']);

const turnRef = { conversationId: z.uuid(), turnId: z.uuid() };
/** Events the reader UI reports through `POST /api/public/sites/:id/chat/events`. */
export const aiChatClientEventSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('chat_opened'), source: aiChatOpenSourceSchema, conversationId: z.uuid() }).strict(),
  z
    .object({ name: z.literal('citation_clicked'), ...turnRef, citationId: z.string().min(1).max(16), position: z.number().int().min(1).max(50) })
    .strict(),
  z.object({ name: z.literal('follow_up_clicked'), ...turnRef, position: z.number().int().min(1).max(3) }).strict(),
  z.object({ name: z.literal('copy'), ...turnRef }).strict(),
  z.object({ name: z.literal('stop'), conversationId: z.uuid() }).strict(),
  z.object({ name: z.literal('new_chat'), conversationId: z.uuid() }).strict(),
]);
export type AiChatClientEvent = z.infer<typeof aiChatClientEventSchema>;

export const siteChatEventsBody = z
  .object({
    events: z.array(aiChatClientEventSchema).min(1).max(20),
    consent: aiChatConsentSchema.default('unknown'),
    sessionId: z.string().trim().min(8).max(128).optional(),
    lang: z.string().trim().min(2).max(35).optional(),
  })
  .strict();
export type SiteChatEventsBody = z.infer<typeof siteChatEventsBody>;

export const aiChatFeedbackRatingSchema = z.enum(['up', 'down']);
export type AiChatFeedbackRating = z.infer<typeof aiChatFeedbackRatingSchema>;
export const aiChatFeedbackReasonSchema = z.enum([
  // thumbs down
  'incorrect',
  'incomplete',
  'not_relevant',
  'hard_to_understand',
  'outdated',
  // thumbs up
  'accurate',
  'clear',
  'solved',
  'other',
]);
export type AiChatFeedbackReason = z.infer<typeof aiChatFeedbackReasonSchema>;

/** `PUT /api/public/sites/:id/chat/feedback`. Editable: the latest write per
 * turn wins; `rating: null` withdraws the rating. */
export const siteChatFeedbackBody = z
  .object({
    conversationId: z.uuid(),
    turnId: z.uuid(),
    token: z.string().min(16).max(256),
    rating: aiChatFeedbackRatingSchema.nullable(),
    reason: aiChatFeedbackReasonSchema.optional(),
    comment: z.string().trim().max(AI_CHAT_LIMITS.feedbackCommentMax).optional(),
    /** The rating this edit replaces (absent on the first rating), for given/changed analytics. */
    previousRating: aiChatFeedbackRatingSchema.nullable().optional(),
    consent: aiChatConsentSchema.default('unknown'),
    lang: z.string().trim().min(2).max(35).optional(),
  })
  .strict();
export type SiteChatFeedbackBody = z.infer<typeof siteChatFeedbackBody>;

// ─── Workspace dashboard + MCP read models ──────────────────────────────────

export const aiConversationRangeSchema = z.enum(['7d', '30d', '90d']);
export type AiConversationRange = z.infer<typeof aiConversationRangeSchema>;
export const aiConversationTurnStatusSchema = z.enum(['answered', 'no_answer', 'failed', 'cancelled']);
export type AiConversationTurnStatus = z.infer<typeof aiConversationTurnStatusSchema>;
/** `disabled`: analytics storage is off on this instance. `unavailable`: storage
 * is configured but could not be read right now. */
export const aiConversationAvailabilitySchema = z.enum(['available', 'disabled', 'unavailable']);

const isoDate = z.string();

export const aiConversationListQuery = z
  .object({
    range: aiConversationRangeSchema.default('30d'),
    language: z.string().trim().min(2).max(35).optional(),
    rating: z.enum(['up', 'down', 'unrated']).optional(),
    /** `no_answer` is the dashboard's "Unanswered" filter. */
    status: z.enum(['answered', 'no_answer', 'failed']).optional(),
    q: z.string().trim().min(1).max(120).optional(),
    cursor: z.string().min(1).max(256).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
export type AiConversationListQuery = z.infer<typeof aiConversationListQuery>;

export const aiConversationListItemSchema = z
  .object({
    conversationId: z.string(),
    startedAt: isoDate,
    lastActivityAt: isoDate,
    language: z.string(),
    turns: z.number().int().min(0),
    /** Null when question text was not saved (capture off or no consent). */
    firstQuestion: z.string().nullable(),
    answered: z.number().int().min(0),
    noAnswer: z.number().int().min(0),
    failed: z.number().int().min(0),
    /** Questions the reader stopped before a checked answer. */
    cancelled: z.number().int().min(0),
    rating: z.enum(['up', 'down', 'mixed']).nullable(),
    pagePath: z.string().nullable(),
  })
  .strict();
export type AiConversationListItem = z.infer<typeof aiConversationListItemSchema>;

export const aiConversationListResultSchema = z
  .object({
    availability: aiConversationAvailabilitySchema,
    captureEnabled: z.boolean(),
    /** Why text is not saved: the site setting is off, or the instance has no encryption key. */
    captureOffReason: z.enum(['setting', 'instance']).optional(),
    items: z.array(aiConversationListItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export type AiConversationListResult = z.infer<typeof aiConversationListResultSchema>;

export const aiConversationFeedbackSchema = z
  .object({
    rating: aiChatFeedbackRatingSchema,
    reason: aiChatFeedbackReasonSchema.nullable(),
    comment: z.string().nullable(),
    updatedAt: isoDate,
  })
  .strict();

export const aiConversationTurnSchema = z
  .object({
    turnId: z.string(),
    turnIndex: z.number().int().min(0),
    occurredAt: isoDate,
    question: z.string().nullable(),
    /** The standalone query used for retrieval after follow-up rewriting. */
    rewrittenQuery: z.string().nullable(),
    answer: z.string().nullable(),
    status: aiConversationTurnStatusSchema,
    noAnswerReason: z.string().nullable(),
    citations: z.array(
      z.object({ id: z.string(), title: z.string(), path: z.string(), heading: z.string().optional(), anchor: z.string().optional() }).strict(),
    ),
    suggestions: z.array(z.object({ title: z.string(), path: z.string() }).strict()),
    pagePath: z.string().nullable(),
    language: z.string(),
    version: z.string().optional(),
    provider: z.string().nullable(),
    model: z.string().nullable(),
    inputTokens: z.number().int().min(0).nullable(),
    outputTokens: z.number().int().min(0).nullable(),
    costUsd: z.number().min(0).nullable(),
    latencyMs: z.number().int().min(0).nullable(),
    feedback: aiConversationFeedbackSchema.nullable(),
  })
  .strict();
export type AiConversationTurn = z.infer<typeof aiConversationTurnSchema>;

export const aiConversationDetailSchema = z
  .object({
    conversationId: z.string(),
    language: z.string(),
    startedAt: isoDate,
    visibility: z.enum(['public', 'private']),
    turns: z.array(aiConversationTurnSchema),
  })
  .strict();
export type AiConversationDetail = z.infer<typeof aiConversationDetailSchema>;

export const aiConversationSummaryQuery = z
  .object({
    range: aiConversationRangeSchema.default('30d'),
    language: z.string().trim().min(2).max(35).optional(),
    timezone: z.string().trim().min(1).max(64).default('UTC'),
  })
  .strict();
export type AiConversationSummaryQuery = z.infer<typeof aiConversationSummaryQuery>;

export const aiConversationSummarySchema = z
  .object({
    availability: aiConversationAvailabilitySchema,
    captureEnabled: z.boolean(),
    /** Why text is not saved: the site setting is off, or the instance has no encryption key. */
    captureOffReason: z.enum(['setting', 'instance']).optional(),
    range: aiConversationRangeSchema,
    totals: z
      .object({
        conversations: z.number().int().min(0),
        questions: z.number().int().min(0),
        answered: z.number().int().min(0),
        noAnswer: z.number().int().min(0),
        failed: z.number().int().min(0),
      })
      .strict(),
    feedback: z
      .object({
        up: z.number().int().min(0),
        down: z.number().int().min(0),
        reasons: z.array(z.object({ reason: aiChatFeedbackReasonSchema, count: z.number().int().min(0) }).strict()),
      })
      .strict(),
    usage: z
      .object({
        inputTokens: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
        /** Null when no provider in the range reported cost. */
        costUsd: z.number().min(0).nullable(),
        /** True when every turn in the range reported its cost. */
        costComplete: z.boolean(),
      })
      .strict(),
    timeseries: z.array(
      z
        .object({
          date: z.string(),
          questions: z.number().int().min(0),
          answered: z.number().int().min(0),
          noAnswer: z.number().int().min(0),
          up: z.number().int().min(0),
          down: z.number().int().min(0),
          inputTokens: z.number().int().min(0),
          outputTokens: z.number().int().min(0),
          costUsd: z.number().min(0).nullable(),
        })
        .strict(),
    ),
    languages: z.array(z.object({ language: z.string(), questions: z.number().int().min(0) }).strict()),
    /** Counts from the chat event catalog over the same range. */
    engagement: z
      .object({
        opens: z.number().int().min(0),
        opensBySource: z.array(z.object({ source: aiChatOpenSourceSchema, count: z.number().int().min(0) }).strict()),
        citationClicks: z.number().int().min(0),
        followUpClicks: z.number().int().min(0),
        copies: z.number().int().min(0),
        stops: z.number().int().min(0),
        newChats: z.number().int().min(0),
        feedbackGiven: z.number().int().min(0),
        feedbackChanged: z.number().int().min(0),
        quotaReached: z.number().int().min(0),
        providerErrors: z.number().int().min(0),
        /** Median time to first streamed token; null without data. */
        medianFirstTokenMs: z.number().int().min(0).nullable(),
        medianLatencyMs: z.number().int().min(0).nullable(),
      })
      .strict(),
  })
  .strict();
export type AiConversationSummary = z.infer<typeof aiConversationSummarySchema>;

export const aiContentGapsQuery = z
  .object({
    range: aiConversationRangeSchema.default('30d'),
    language: z.string().trim().min(2).max(35).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
export type AiContentGapsQuery = z.infer<typeof aiContentGapsQuery>;

export const aiContentGapSchema = z
  .object({
    /** Representative (redacted) wording of the question. */
    question: z.string(),
    language: z.string(),
    askedCount: z.number().int().min(1),
    noAnswerCount: z.number().int().min(0),
    downCount: z.number().int().min(0),
    lastAskedAt: isoDate,
    sampleConversationId: z.string(),
    /** Why it is a gap: the assistant could not answer, or readers rated answers down. */
    reason: z.enum(['no_answer', 'low_rating']),
  })
  .strict();
export type AiContentGap = z.infer<typeof aiContentGapSchema>;

export const aiContentGapsResultSchema = z
  .object({
    availability: aiConversationAvailabilitySchema,
    captureEnabled: z.boolean(),
    /** Why text is not saved: the site setting is off, or the instance has no encryption key. */
    captureOffReason: z.enum(['setting', 'instance']).optional(),
    items: z.array(aiContentGapSchema),
  })
  .strict();
export type AiContentGapsResult = z.infer<typeof aiContentGapsResultSchema>;
