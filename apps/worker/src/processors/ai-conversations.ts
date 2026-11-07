import {
  aiConversationJobSchema,
  openAiConversation,
  resolveAiConversationKey,
  resolveAiConversationTransportKey,
} from '@nibleaf/bullmq/jobs/ai-conversations';
import {
  aiFeedbackRowSchema,
  aiTurnRowSchema,
  getClickHouseClient,
  isAiConversationDeleted,
  keys,
  purgeAiConversation,
  refreshAiUsageDaily,
} from '@nibleaf/clickhouse';
import { prisma, runWithTenantAnalyticsWriteFence } from '@nibleaf/database';
import { env } from '../env';
export const handleAiConversationJob = async (data: unknown, client?: ReturnType<typeof getClickHouseClient>): Promise<{ inserted: number }> => {
  let phase = 'validation';
  try {
    if (keys().ANALYTICS_MODE === 'disabled') return { inserted: 0 };
    const job = aiConversationJobSchema.parse(data);
    const archiveKey = resolveAiConversationKey(env);
    const key = resolveAiConversationTransportKey({ ...env, ANALYTICS_HASH_SALT: keys().ANALYTICS_HASH_SALT });
    phase = 'open';
    const decoded = openAiConversation(job.sealed, job.tenantId, job.projectId, key);
    const row = job.kind === 'ai-conversation-turn' ? aiTurnRowSchema.parse(decoded) : aiFeedbackRowSchema.parse(decoded);
    if (row.tenant_id !== job.tenantId || row.project_id !== job.projectId) throw new Error('scope');
    if (
      !archiveKey &&
      (row.content_captured ||
        ('question' in row && (row.question || row.answer || row.rewritten_query || row.question_key)) ||
        ('comment' in row && row.comment))
    )
      throw new Error('plaintext');
    if (Date.parse(row.expires_at) <= Date.now()) return { inserted: 0 };
    phase = 'project';
    const project = await prisma.project.findFirst({ where: { id: job.projectId, organizationId: job.tenantId }, select: { id: true } });
    if (!project) return { inserted: 0 };
    const ch = client ?? getClickHouseClient('writer');
    const scope = { tenantId: job.tenantId, projectId: job.projectId };
    const write = async () => {
      phase = 'deletion check';
      if (await isAiConversationDeleted(scope, row.conversation_id, ch)) {
        await purgeAiConversation(scope, row.conversation_id, ch);
        return { inserted: 0 };
      }
      phase = 'insert';
      await ch.insert({
        table: job.kind === 'ai-conversation-turn' ? 'ai_conversation_turns' : 'ai_conversation_feedback',
        format: 'JSONEachRow',
        values: [row],
      });
      phase = 'post insert check';
      if (await isAiConversationDeleted(scope, row.conversation_id, ch)) {
        phase = 'purge';
        await purgeAiConversation(scope, row.conversation_id, ch);
        return { inserted: 0 };
      }
      if ('occurred_at' in row) {
        phase = 'rollup';
        await refreshAiUsageDaily(scope, [row.occurred_at.slice(0, 10)], ch);
      }
      return { inserted: 1 };
    };
    const result = await runWithTenantAnalyticsWriteFence(job.tenantId, job.projectId, null, write);
    return result.accepted ? result.value : { inserted: 0 };
  } catch {
    throw new Error(`ai conversation ${phase} failed`);
  }
};
