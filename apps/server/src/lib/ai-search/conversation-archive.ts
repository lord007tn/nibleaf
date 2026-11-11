import { createHash, createHmac } from 'node:crypto';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { resolveAiConversationKey, resolveAiConversationTransportKey, sealAiConversation } from '@nibleaf/bullmq/jobs/ai-conversations';
import { aiFeedbackRowSchema, aiTurnRowSchema, classifyUserAgent, keys, redactConversationText, redactReaderText } from '@nibleaf/clickhouse';
import { markAnalyticsStoragePending } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { normalizeArabicSearchText } from '@nibleaf/search';
import { analyticsConsentPolicy } from '@nibleaf/shared/analytics-consent';
import type { AiChatConsent, AiConversationTurnStatus } from '@nibleaf/validators';
import { env } from '@/env';

const log = createLogger({ module: 'ai-conversation-archive' });
interface CapturePolicy {
  captureSetting: boolean;
  consent: AiChatConsent;
  consentRequired: boolean;
}
export interface ChatTurnCapture extends CapturePolicy {
  tenantId: string;
  projectId: string;
  conversationId: string;
  turnId: string;
  turnIndex: number;
  occurredAt: Date;
  deploymentId: string;
  versionSlug: string;
  language: string;
  visibility: 'public' | 'private';
  sessionId?: string;
  /** The reader's user agent; declared bots are recorded as actor_type 'bot'. */
  userAgent?: string;
  pagePath?: string;
  status: AiConversationTurnStatus;
  noAnswerReason?: string;
  question: string;
  rewrittenQuery?: string;
  answer?: string;
  citations: { id: string; pageId: string; title: string; path: string; heading?: string; anchor?: string }[];
  suggestions: { pageId: string; title: string; path: string }[];
  provider?: string;
  model?: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** The answer model's totals include estimates for calls that never reported
   * usage (a stopped or failed turn): stored, but flagged unknown, as is the cost. */
  usageEstimated?: boolean;
  /** Rewriting and suggestions on a separate utility model: its usage, apart
   * from the answer model's (inputTokens, outputTokens, costUsd). */
  utilityModel?: string;
  utilityInputTokens?: number;
  utilityOutputTokens?: number;
  utilityCostUsd?: number;
  /** Like usageEstimated, for the utility model's calls. */
  utilityUsageEstimated?: boolean;
  latencyMs?: number;
  firstTokenMs?: number;
  retrievalCacheHit?: boolean;
  retrievalConfidence?: number;
  chunkCount?: number;
}
export interface ChatFeedbackCapture extends CapturePolicy {
  tenantId: string;
  projectId: string;
  conversationId: string;
  turnId: string;
  rating: 'up' | 'down' | null;
  reason?: string;
  comment?: string;
  language?: string;
  visibility: 'public' | 'private';
}
/** Every piece of configuration the archive needs, checked in one place, so
 * what readers are told and what is written can never disagree:
 *  - `rows`: any row at all. Analytics writes are on and the hash salt is set
 *    (each row's job id and question key are salted hashes, and a metadata-only
 *    row is sealed with a key derived from the salt).
 *  - `questionText`: rows, plus a key that encrypts the question text. */
const archiveReadiness = (): { rows: boolean; questionText: boolean } => {
  try {
    const { ANALYTICS_MODE, ANALYTICS_HASH_SALT } = keys();
    const rows = ANALYTICS_MODE !== 'disabled' && Boolean(ANALYTICS_HASH_SALT);
    return { rows, questionText: rows && Boolean(resolveAiConversationKey(env)) };
  } catch {
    return { rows: false, questionText: false };
  }
};
/** This instance can archive question text. The reader's disclosure and the
 * archive itself both use it. */
export const aiConversationCaptureReady = (): boolean => archiveReadiness().questionText;
/** What the reader's chat may say about storing questions. Question text is kept
 * only when the site's capture setting is on and this instance can encrypt and
 * write it; each reader's consent then applies on top (see below). */
export const readerQuestionStorage = (captureSetting: boolean) => {
  const storesQuestions = captureSetting && aiConversationCaptureReady();
  return { storesQuestions, questionRetentionDays: storesQuestions ? env.AI_CONVERSATION_RETENTION_DAYS : null };
};
/** The capture policy a reader's chat discloses, with a short revision of it.
 * Each chat turn carries the revision its reader was shown; the server refuses
 * a turn whose revision is no longer current, so a page left open while capture
 * or consent changed can never send a question under terms it did not show. */
export const readerChatPolicy = (config: unknown, captureSetting: boolean) => {
  const storage = readerQuestionStorage(captureSetting);
  const consent = analyticsConsentPolicy(config);
  const revision = createHash('sha256')
    .update(JSON.stringify(['chat-policy:v1', storage.storesQuestions, storage.questionRetentionDays, consent]))
    .digest('hex')
    .slice(0, 16);
  return { ...storage, consent, revision };
};
export const aiConversationContentAllowed = (policy: CapturePolicy): boolean =>
  policy.captureSetting && aiConversationCaptureReady() && (policy.consentRequired ? policy.consent === 'granted' : policy.consent !== 'denied');
const hash = (value: string) => {
  const salt = keys().ANALYTICS_HASH_SALT;
  if (!salt) throw new Error('archive hash configuration');
  return createHmac('sha256', salt).update(value).digest('hex');
};
const normalizeConversationQuestion = (value: string) =>
  normalizeArabicSearchText(value.normalize('NFKC').toLowerCase())
    .replace(/[\p{P}\p{S}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
const scope = (c: ChatFeedbackCapture | ChatTurnCapture) => ({
  tenant_id: c.tenantId,
  project_id: c.projectId,
  conversation_id: c.conversationId,
  turn_id: c.turnId,
});
const expiry = (date: Date) => new Date(date.getTime() + env.AI_CONVERSATION_RETENTION_DAYS * 86_400_000).toISOString();
export const buildAiTurnRow = (c: ChatTurnCapture) => {
  const allowed = aiConversationContentAllowed(c);
  const redact = (v?: string, limit?: number) => (allowed ? redactConversationText(v ?? '', limit) : '');
  // What people type loses links and long numbers too, as search terms do.
  const redactTyped = (v?: string, limit?: number) => (allowed ? redactReaderText(v ?? '', limit) : '');
  const sources = (items: { id?: string; pageId: string; title: string; path: string; heading?: string; anchor?: string }[]) =>
    JSON.stringify(
      items.map((i) => ({
        ...i,
        title: allowed ? redactConversationText(i.title) : '',
        ...(i.heading ? { heading: allowed ? redactConversationText(i.heading) : '' } : {}),
        path: redactConversationText(i.path).split(/[?#]/u)[0],
      })),
    );
  return aiTurnRowSchema.parse({
    ...scope(c),
    turn_index: c.turnIndex,
    occurred_at: c.occurredAt.toISOString(),
    received_at: new Date().toISOString(),
    expires_at: expiry(c.occurredAt),
    deployment_id: c.deploymentId,
    version_slug: c.versionSlug,
    language: c.language,
    visibility: c.visibility,
    consent_state: c.consent,
    content_captured: allowed ? 1 : 0,
    session_hash: sessionHash(c),
    page_path: redactConversationText(c.pagePath ?? '').split(/[?#]/u)[0],
    status: c.status,
    no_answer_reason: c.noAnswerReason ?? '',
    question: redactTyped(c.question, 1000),
    rewritten_query: redactTyped(c.rewrittenQuery),
    answer: redact(c.answer),
    // Follow-ups ("can I do that for one notebook?") group by their standalone rewrite.
    question_key: allowed && c.question ? hash(normalizeConversationQuestion(c.rewrittenQuery || c.question)) : '',
    citations: sources(c.citations),
    suggestions: sources(c.suggestions),
    provider: c.provider ?? '',
    model: c.model ?? '',
    prompt_version: c.promptVersion,
    input_tokens: c.inputTokens ?? 0,
    output_tokens: c.outputTokens ?? 0,
    // Each model's tokens and cost are known on their own: the answer model's
    // here, the utility model's below. A turn's totals need both.
    tokens_known: !c.usageEstimated && c.inputTokens !== undefined && c.outputTokens !== undefined ? 1 : 0,
    cost_micros: Math.round((c.costUsd ?? 0) * 1e6),
    cost_known: !c.usageEstimated && c.costUsd !== undefined ? 1 : 0,
    utility_model: c.utilityModel ?? '',
    utility_input_tokens: c.utilityInputTokens ?? 0,
    utility_output_tokens: c.utilityOutputTokens ?? 0,
    utility_cost_micros: Math.round((c.utilityCostUsd ?? 0) * 1e6),
    utility_tokens_known: c.utilityModel && !c.utilityUsageEstimated ? 1 : 0,
    utility_cost_known: c.utilityModel && !c.utilityUsageEstimated && c.utilityCostUsd !== undefined ? 1 : 0,
    latency_ms: c.latencyMs ?? null,
    first_token_ms: c.firstTokenMs ?? null,
    retrieval_confidence: c.retrievalConfidence ?? 0,
    chunk_count: c.chunkCount ?? 0,
    retrieval_cache_hit: c.retrievalCacheHit ? 1 : 0,
    actor_type: classifyUserAgent(c.userAgent).actorType,
  });
};
export const buildAiFeedbackRow = (c: ChatFeedbackCapture) => {
  const now = new Date();
  const allowed = aiConversationContentAllowed(c);
  return aiFeedbackRowSchema.parse({
    ...scope(c),
    rating: c.rating ?? '',
    reason: c.rating ? (c.reason ?? '') : '',
    comment: allowed && c.rating ? redactReaderText(c.comment ?? '', 1000) : '',
    content_captured: allowed ? 1 : 0,
    language: c.language ?? '',
    consent_state: c.consent,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: expiry(now),
  });
};
const record = async (c: ChatFeedbackCapture | ChatTurnCapture, kind: 'ai-conversation-turn' | 'ai-conversation-feedback') => {
  try {
    // Nothing is queued unless every row can be written (see archiveReadiness).
    if (!archiveReadiness().rows) return;
    const marker = await markAnalyticsStoragePending(c.tenantId, c.projectId);
    if (!marker.accepted) return;
    const key = resolveAiConversationTransportKey({ ...env, ANALYTICS_HASH_SALT: keys().ANALYTICS_HASH_SALT });
    const row = kind === 'ai-conversation-turn' ? buildAiTurnRow(c as ChatTurnCapture) : buildAiFeedbackRow(c as ChatFeedbackCapture);
    const sealed = sealAiConversation(row, c.tenantId, c.projectId, key);
    const jobId = `ai-${hash(JSON.stringify([kind, c.tenantId, c.projectId, c.turnId, 'updated_at' in row ? row.updated_at : '']))}`;
    await createJob(
      QueueNames.ANALYTICS,
      { name: kind, data: { kind, tenantId: c.tenantId, projectId: c.projectId, sealed } },
      { jobId, attempts: 3, backoff: { type: 'exponential', delay: 1000 }, removeOnComplete: true, removeOnFail: { age: 3600, count: 100 } },
    );
  } catch {
    log.warn('ai conversation capture failed');
  }
};
export const recordAiChatTurn = (capture: ChatTurnCapture): Promise<void> => record(capture, 'ai-conversation-turn');
export const recordAiChatFeedback = (capture: ChatFeedbackCapture): Promise<void> => record(capture, 'ai-conversation-feedback');

/** The analytics session hash (same scheme as analytics_events), only with
 * consent: "not required" counts only where the site really doesn't ask. */
const sessionHash = (c: Pick<ChatTurnCapture, 'consent' | 'consentRequired' | 'sessionId' | 'tenantId' | 'projectId'>) =>
  c.sessionId && (c.consent === 'granted' || (c.consent === 'not_required' && !c.consentRequired))
    ? hash(`session:${JSON.stringify([c.tenantId, c.projectId])}:${c.sessionId}`)
    : null;
