import {
  deleteAiConversation,
  emptyAiSummary,
  keys,
  queryAiContentGaps,
  queryAiConversation,
  queryAiConversationSummary,
  queryAiConversations,
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
  return { captureEnabled: config?.search?.aiConversationCapture !== false && aiConversationCaptureReady(), scope: { tenantId, projectId } };
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
  });
};
export const listProjectAiContentGaps = async (tenantId: string, projectId: string, query: AiContentGapsQuery) => {
  const c = await context(tenantId, projectId);
  return aiContentGapsResultSchema.parse({
    ...(await read(() => queryAiContentGaps(c.scope, query), { items: [] })),
    captureEnabled: c.captureEnabled,
  });
};
