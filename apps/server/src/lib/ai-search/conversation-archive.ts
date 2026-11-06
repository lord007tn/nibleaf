import { createHmac } from 'node:crypto';
import { createJob, QueueNames } from '@nibleaf/bullmq';
import { resolveAiConversationKey, resolveAiConversationTransportKey, sealAiConversation } from '@nibleaf/bullmq/jobs/ai-conversations';
import { aiFeedbackRowSchema, aiTurnRowSchema, classifyUserAgent, keys, redactConversationText, redactReaderText } from '@nibleaf/clickhouse';
import { markAnalyticsStoragePending } from '@nibleaf/database';
import { createLogger } from '@nibleaf/logger';
import { normalizeArabicSearchText } from '@nibleaf/search';
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
  citations: { id: string; pageId: string; title: string; path: string }[];
  suggestions: { pageId: string; title: string; path: string }[];
  provider?: string;
  model?: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** Token totals include estimates for calls that never reported usage (a
   * stopped or failed turn): stored, but flagged unknown, as is the cost. */
  usageEstimated?: boolean;
  /** Rewriting and suggestions on a separate utility model: its usage, apart
   * from the answer model's (inputTokens, outputTokens, costUsd). */
  utilityModel?: string;
  utilityInputTokens?: number;
  utilityOutputTokens?: number;
  utilityCostUsd?: number;
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
export const aiConversationCaptureReady = (): boolean => {
  try {
    return keys().ANALYTICS_MODE !== 'disabled' && Boolean(resolveAiConversationKey(env));
  } catch {
    return false;
  }
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
  const sources = (items: { id?: string; pageId: string; title: string; path: string }[]) =>
    JSON.stringify(
      items.map((i) => ({ ...i, title: allowed ? redactConversationText(i.title) : '', path: redactConversationText(i.path).split(/[?#]/u)[0] })),
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
    tokens_known: !c.usageEstimated && c.inputTokens !== undefined && c.outputTokens !== undefined ? 1 : 0,
    cost_micros: Math.round((c.costUsd ?? 0) * 1e6),
    // Known only when every call of the turn reported its cost.
    cost_known: !c.usageEstimated && c.costUsd !== undefined && (!c.utilityModel || c.utilityCostUsd !== undefined) ? 1 : 0,
    utility_model: c.utilityModel ?? '',
    utility_input_tokens: c.utilityInputTokens ?? 0,
    utility_output_tokens: c.utilityOutputTokens ?? 0,
    utility_cost_micros: Math.round((c.utilityCostUsd ?? 0) * 1e6),
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
    if (keys().ANALYTICS_MODE === 'disabled') return;
    const marker = await markAnalyticsStoragePending(c.tenantId);
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
