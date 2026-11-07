import {
  deleteAiConversation,
  emptyAiSummary,
  keys,
  queryAiContentGaps,
  queryAiConversation,
  queryAiConversationSummary,
  queryAiConversations,
  queryAiUsageDaily,
} from '@nibleaf/clickhouse';
import { createLogger } from '@nibleaf/logger';
import {
  type AiContentGapsQuery,
  type AiConversationListQuery,
  type AiConversationSummaryQuery,
  aiContentGapsResultSchema,
  aiConversationDetailSchema,
  aiConversationListResultSchema,
  aiConversationSummarySchema,
} from '@nibleaf/validators';
import { AppError, notFound } from '@/errors';
import { aiConversationCaptureReady } from '@/lib/ai-search/conversation-archive';
import { assertProjectInOrg } from './projects';

const log = createLogger({ action: 'ai-conversations' });
const context = async (tenantId: string, projectId: string) => {
  const project = await assertProjectInOrg(tenantId, projectId);
  const config = project.config as { search?: { aiConversationCapture?: boolean } } | null;
  const settingOn = config?.search?.aiConversationCapture !== false;
  const instanceReady = aiConversationCaptureReady();
  return {
    captureEnabled: settingOn && instanceReady,
    // A missing encryption key is the operator's to fix, not the site admin's.
    capture: settingOn ? (instanceReady ? {} : { captureOffReason: 'instance' as const }) : { captureOffReason: 'setting' as const },
    scope: { tenantId, projectId },
  };
};
const read = async <T>(run: () => Promise<T>, fallback: T) => {
  if (keys().ANALYTICS_MODE === 'disabled') return { ...fallback, availability: 'disabled' as const };
  try {
    return { ...(await run()), availability: 'available' as const };
  } catch {
    log.warn('ai conversation read failed');
    return { ...fallback, availability: 'unavailable' as const };
  }
};
export const listProjectAiConversations = async (tenantId: string, projectId: string, query: AiConversationListQuery) => {
  const c = await context(tenantId, projectId);
  return aiConversationListResultSchema.parse({
    ...(await read(() => queryAiConversations(c.scope, query), { items: [], nextCursor: null })),
    captureEnabled: c.captureEnabled,
    ...c.capture,
  });
};
export const getProjectAiConversation = async (tenantId: string, projectId: string, conversationId: string) => {
  const c = await context(tenantId, projectId);
  const result = await read(() => queryAiConversation(c.scope, conversationId).then((detail) => ({ detail })), { detail: null });
  if (result.availability !== 'available') throw new AppError({ code: 'storage:error' });
  if (!result.detail) throw notFound('ai conversation');
  return aiConversationDetailSchema.parse(result.detail);
};
export const deleteProjectAiConversation = async (tenantId: string, projectId: string, conversationId: string) => {
  const c = await context(tenantId, projectId);
  await deleteAiConversation(c.scope, conversationId);
  return { deleted: true as const };
};
export const getProjectAiConversationSummary = async (tenantId: string, projectId: string, query: AiConversationSummaryQuery) => {
  const c = await context(tenantId, projectId);
  return aiConversationSummarySchema.parse({
    ...(await read(() => queryAiConversationSummary(c.scope, query), emptyAiSummary(query.range))),
    captureEnabled: c.captureEnabled,
    ...c.capture,
  });
};
export const listProjectAiContentGaps = async (tenantId: string, projectId: string, query: AiContentGapsQuery) => {
  const c = await context(tenantId, projectId);
  return aiContentGapsResultSchema.parse({
    ...(await read(() => queryAiContentGaps(c.scope, query), { items: [] })),
    captureEnabled: c.captureEnabled,
    ...c.capture,
  });
};

const usageNumber = (row: Record<string, string | number>, key: string) => Number(row[key] ?? 0);
const average = (sum: number, count: number) => (count > 0 ? Math.round(sum / count) : null);

const usageTotals = (rows: Record<string, string | number>[]) => {
  const sum = (key: string) => rows.reduce((total, row) => total + usageNumber(row, key), 0);
  return {
    questions: sum('questions'),
    answered: sum('answered'),
    noAnswer: sum('no_answer'),
    failed: sum('failed'),
    cancelled: sum('cancelled'),
    inputTokens: sum('input_tokens'),
    outputTokens: sum('output_tokens'),
    costUsd: sum('cost_micros') / 1_000_000,
    costKnownAnswers: sum('cost_known_turns'),
    averageLatencyMs: average(sum('latency_ms_sum'), sum('latency_turns')),
    averageFirstTokenMs: average(sum('first_token_ms_sum'), sum('first_token_turns')),
    retrievalCacheHits: sum('retrieval_cache_hits'),
  };
};

/** Daily usage per model in plain units (USD, milliseconds), with totals. Cost
 * sums the calls whose provider reported it; costKnownAnswers counts answers
 * whose every call, on every model, did. A utility model has its own rows. */
export const getProjectAiUsage = async (tenantId: string, projectId: string, query: AiConversationSummaryQuery) => {
  const c = await context(tenantId, projectId);
  return read(
    async () => {
      const rows = await queryAiUsageDaily(c.scope, query);
      const days = rows.map((row) => ({
        day: String(row.day),
        provider: String(row.provider),
        model: String(row.model),
        questions: usageNumber(row, 'questions'),
        answered: usageNumber(row, 'answered'),
        noAnswer: usageNumber(row, 'no_answer'),
        failed: usageNumber(row, 'failed'),
        cancelled: usageNumber(row, 'cancelled'),
        inputTokens: usageNumber(row, 'input_tokens'),
        outputTokens: usageNumber(row, 'output_tokens'),
        costUsd: usageNumber(row, 'cost_micros') / 1_000_000,
        costKnownAnswers: usageNumber(row, 'cost_known_turns'),
        averageLatencyMs: average(usageNumber(row, 'latency_ms_sum'), usageNumber(row, 'latency_turns')),
        averageFirstTokenMs: average(usageNumber(row, 'first_token_ms_sum'), usageNumber(row, 'first_token_turns')),
        retrievalCacheHits: usageNumber(row, 'retrieval_cache_hits'),
      }));
      return { days, totals: usageTotals(rows) };
    },
    { days: [], totals: usageTotals([]) },
  );
};
