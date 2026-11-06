import { z } from 'zod';
import { getClickHouseClient } from './client';
import type { ClickHouseMigration } from './migrations';

const scope = {
  tenant_id: z.string().min(1),
  project_id: z.string().min(1),
  conversation_id: z.uuid(),
  turn_id: z.uuid(),
  expires_at: z.iso.datetime(),
};
const text = z.string().max(16_000);
const uint = z.number().int().nonnegative();
export const aiTurnRowSchema = z
  .object({
    ...scope,
    turn_index: uint,
    occurred_at: z.iso.datetime(),
    received_at: z.iso.datetime(),
    deployment_id: z.string(),
    version_slug: z.string(),
    language: z.string(),
    visibility: z.enum(['public', 'private']),
    consent_state: z.enum(['denied', 'granted', 'not_required', 'unknown']),
    content_captured: z.union([z.literal(0), z.literal(1)]),
    session_hash: z.string().length(64).nullable(),
    page_path: z.string(),
    status: z.enum(['answered', 'no_answer', 'failed', 'cancelled']),
    no_answer_reason: z.string(),
    question: text.max(1000),
    rewritten_query: text,
    answer: text,
    question_key: z.string().regex(/^(?:[a-f0-9]{64})?$/u),
    citations: z.string(),
    suggestions: z.string(),
    provider: z.string(),
    model: z.string(),
    prompt_version: z.string(),
    input_tokens: uint,
    output_tokens: uint,
    tokens_known: uint.max(1),
    cost_micros: uint,
    cost_known: uint.max(1),
    latency_ms: uint.nullable(),
    first_token_ms: uint.nullable(),
    retrieval_confidence: z.number().finite(),
    chunk_count: uint,
  })
  .strict();
export const aiFeedbackRowSchema = z
  .object({
    ...scope,
    rating: z.enum(['up', 'down', '']),
    reason: z.string(),
    comment: text.max(1000),
    content_captured: uint.max(1),
    language: z.string(),
    consent_state: z.enum(['denied', 'granted', 'not_required', 'unknown']),
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  })
  .strict();
export type AiTurnRow = z.infer<typeof aiTurnRowSchema>;
export type AiFeedbackRow = z.infer<typeof aiFeedbackRowSchema>;

const common = `tenant_id String, project_id String, conversation_id String, turn_id String, expires_at DateTime64(3, 'UTC')`;
// Sources are JSON arrays of {id?,pageId,title,path}; never store source snippets.
export const aiConversationMigrations: ClickHouseMigration[] = [
  {
    version: 1001,
    name: 'ai_conversations_v1',
    statements: [
      `CREATE TABLE IF NOT EXISTS ai_conversation_turns (${common}, turn_index UInt32, occurred_at DateTime64(3, 'UTC'), received_at DateTime64(3, 'UTC'), deployment_id String, version_slug String, language String, visibility String, consent_state String, content_captured UInt8, session_hash Nullable(FixedString(64)), page_path String, status String, no_answer_reason String, question String, rewritten_query String, answer String, question_key FixedString(64), citations String, suggestions String, provider String, model String, prompt_version String, input_tokens UInt64, output_tokens UInt64, tokens_known UInt8, cost_micros UInt64, cost_known UInt8, latency_ms Nullable(UInt64), first_token_ms Nullable(UInt64), retrieval_confidence Float32, chunk_count UInt32) ENGINE = ReplacingMergeTree(received_at) PARTITION BY toYYYYMM(occurred_at) ORDER BY (tenant_id, project_id, conversation_id, turn_id) TTL toDateTime(expires_at) DELETE`,
      `CREATE TABLE IF NOT EXISTS ai_conversation_feedback (${common}, rating String, reason String, comment String, content_captured UInt8, language String, consent_state String, created_at DateTime64(3, 'UTC'), updated_at DateTime64(3, 'UTC')) ENGINE = ReplacingMergeTree(updated_at) ORDER BY (tenant_id, project_id, turn_id) TTL toDateTime(expires_at) DELETE`,
      `CREATE TABLE IF NOT EXISTS ai_conversation_deletions (tenant_id String, project_id String, conversation_id String, deleted_at DateTime64(3, 'UTC')) ENGINE = ReplacingMergeTree(deleted_at) ORDER BY (tenant_id, project_id, conversation_id) TTL toDateTime(deleted_at) + INTERVAL 180 DAY DELETE`,
    ],
  },
];
export interface AiConversationScope {
  tenantId: string;
  projectId: string;
}
const params = (s: AiConversationScope, conversationId = '') => ({ tenant: s.tenantId, project: s.projectId, conversation: conversationId });
export const isAiConversationDeleted = async (s: AiConversationScope, conversationId: string, client = getClickHouseClient('writer')) => {
  const result = await client.query({
    query: `SELECT count() AS n FROM ai_conversation_deletions FINAL WHERE tenant_id={tenant:String} AND project_id={project:String} AND (conversation_id='' OR conversation_id={conversation:String})`,
    query_params: params(s, conversationId),
    format: 'JSONEachRow',
  });
  return (await result.json<{ n: string }>()).some((r) => Number(r.n) > 0);
};
export const purgeAiConversation = async (s: AiConversationScope, conversationId: string, client = getClickHouseClient('writer')) => {
  for (const table of ['ai_conversation_turns', 'ai_conversation_feedback'])
    await client.command({
      query: `ALTER TABLE ${table} DELETE WHERE tenant_id={tenant:String} AND project_id={project:String} AND ({conversation:String}='' OR conversation_id={conversation:String}) SETTINGS mutations_sync=2`,
      query_params: params(s, conversationId),
    });
};
export const deleteAiConversation = async (s: AiConversationScope, conversationId: string, client = getClickHouseClient('writer')) => {
  await client.insert({
    table: 'ai_conversation_deletions',
    format: 'JSONEachRow',
    values: [{ tenant_id: s.tenantId, project_id: s.projectId, conversation_id: conversationId, deleted_at: new Date().toISOString() }],
  });
  await purgeAiConversation(s, conversationId, client);
};
export const deleteProjectAiConversations = (tenantId: string, projectId: string) => deleteAiConversation({ tenantId, projectId }, '');

export interface AiReadQuery {
  range?: '7d' | '30d' | '90d';
  language?: string;
  rating?: 'up' | 'down' | 'unrated';
  status?: 'answered' | 'no_answer' | 'failed';
  q?: string;
  cursor?: string;
  limit?: number;
  timezone?: string;
}
export const buildAiConversationQuery = (
  table: 'ai_conversation_turns' | 'ai_conversation_feedback',
  s: AiConversationScope,
  q: AiReadQuery,
  conversationId = '',
) => ({
  query: `SELECT * FROM ${table} FINAL WHERE tenant_id={tenant:String} AND project_id={project:String} AND expires_at>now64(3)
 AND ({conversation:String}='' OR conversation_id={conversation:String})
 AND (${table === 'ai_conversation_turns' ? 'occurred_at' : 'created_at'} >= parseDateTime64BestEffort({since:String}))
 AND ({language:String}='' OR language={language:String})
 AND (tenant_id,project_id) NOT IN (SELECT tenant_id,project_id FROM ai_conversation_deletions FINAL WHERE conversation_id='')
 AND (tenant_id,project_id,conversation_id) NOT IN (SELECT tenant_id,project_id,conversation_id FROM ai_conversation_deletions FINAL)`,
  query_params: {
    ...params(s, conversationId),
    since: conversationId ? '1970-01-01T00:00:00.000Z' : new Date(Date.now() - Number.parseInt(q.range ?? '30d', 10) * 86_400_000).toISOString(),
    language: table === 'ai_conversation_feedback' ? '' : (q.language ?? ''),
  },
  format: 'JSONEachRow' as const,
});
const iso = (s: string) => new Date(s.endsWith('Z') ? s : `${s.replace(' ', 'T')}Z`).toISOString();
const read = async (s: AiConversationScope, q: AiReadQuery, conversationId = '') => {
  const client = getClickHouseClient('reader');
  const [t, f] = await Promise.all([
    client.query(buildAiConversationQuery('ai_conversation_turns', s, q, conversationId)),
    client.query(buildAiConversationQuery('ai_conversation_feedback', s, q, conversationId)),
  ]);
  return { turns: await t.json<AiTurnRow>(), feedback: await f.json<AiFeedbackRow>() };
};
// FINAL resolves replacement rows before mutable feedback ratings are filtered.
const archiveWhere = `tenant_id={tenant:String} AND project_id={project:String} AND expires_at>now64(3)
 AND conversation_id NOT IN (SELECT conversation_id FROM ai_conversation_deletions FINAL
   WHERE tenant_id={tenant:String} AND project_id={project:String})
 AND {project:String} NOT IN (SELECT project_id FROM ai_conversation_deletions FINAL
   WHERE tenant_id={tenant:String} AND project_id={project:String} AND conversation_id='')`;
const archiveParams = (s: AiConversationScope, q: AiReadQuery) => ({
  ...params(s),
  since: new Date(Date.now() - Number.parseInt(q.range ?? '30d', 10) * 86_400_000).toISOString(),
  language: q.language ?? '',
});
const turnsWhere = `${archiveWhere} AND occurred_at>=parseDateTime64BestEffort({since:String})
 AND ({language:String}='' OR language={language:String})`;
const feedbackSource = `SELECT conversation_id,turn_id,rating,reason,updated_at FROM ai_conversation_feedback FINAL
 WHERE ${archiveWhere} AND created_at>=parseDateTime64BestEffort({since:String}) AND rating!=''`;
const archiveRows = async <T>(query: string, queryParams: Record<string, string | number>) => {
  const result = await getClickHouseClient('reader').query({ query, query_params: queryParams, format: 'JSONEachRow' });
  return result.json<T>();
};
type Count = string | number;
interface ConversationAggregate {
  conversationId: string;
  startedAt: string;
  lastActivityAt: string;
  language: string;
  turns: Count;
  firstQuestion: string | null;
  answered: Count;
  noAnswer: Count;
  failed: Count;
  rating: 'up' | 'down' | 'mixed' | null;
  pagePath: string | null;
}
export const queryAiConversations = async (s: AiConversationScope, q: AiReadQuery) => {
  const [cursorDate, cursorId] = q.cursor
    ? z.tuple([z.iso.datetime(), z.string().min(1)]).parse(Buffer.from(q.cursor, 'base64url').toString().split('|'))
    : ['1970-01-01T00:00:00.000Z', ''];
  const limit = q.limit ?? 25;
  const rows = await archiveRows<ConversationAggregate>(
    `
 WITH conversations AS (
 SELECT conversation_id AS conversationId,min(occurred_at) AS startedAt,max(occurred_at) AS lastActivityAt,
 argMin(tuple(language,content_captured,question,page_path),tuple(occurred_at,turn_index)) AS first,
 count() AS turns,countIf(status='answered') AS answered,countIf(status='no_answer') AS noAnswer,
 countIf(status='failed') AS failed,countIf(status={status:String}) AS statusMatches,
 countIf(content_captured=1 AND positionCaseInsensitiveUTF8(question,{search:String})>0) AS searchMatches
 FROM ai_conversation_turns FINAL WHERE ${turnsWhere} GROUP BY conversation_id
 ), feedback AS (
 SELECT conversation_id,countIf(rating='up') AS ups,countIf(rating='down') AS downs
 FROM (${feedbackSource}) GROUP BY conversation_id)
 SELECT conversationId,startedAt,lastActivityAt,first.1 AS language,turns,
 if(first.2=1,toNullable(first.3),NULL) AS firstQuestion,answered,noAnswer,failed,
 multiIf(ups>0 AND downs>0,'mixed',ups>0,'up',downs>0,'down',NULL) AS rating,nullIf(first.4,'') AS pagePath
 FROM conversations LEFT JOIN feedback ON conversationId=feedback.conversation_id
 WHERE ({status:String}='' OR statusMatches>0) AND ({search:String}='' OR searchMatches>0)
 AND ({rating:String}='' OR ({rating:String}='unrated' AND ups=0 AND downs=0)
 OR ({rating:String}='up' AND ups>0) OR ({rating:String}='down' AND downs>0))
 AND ({cursorId:String}='' OR (lastActivityAt,conversationId)<(parseDateTime64BestEffort({cursorDate:String}),{cursorId:String}))
 ORDER BY lastActivityAt DESC,conversationId DESC LIMIT {fetchLimit:UInt64}`,
    { ...archiveParams(s, q), status: q.status ?? '', search: q.q ?? '', rating: q.rating ?? '', cursorDate, cursorId, fetchLimit: limit + 1 },
  );
  const items = rows.slice(0, limit).map((r) => ({
    ...r,
    startedAt: iso(r.startedAt),
    lastActivityAt: iso(r.lastActivityAt),
    turns: Number(r.turns),
    answered: Number(r.answered),
    noAnswer: Number(r.noAnswer),
    failed: Number(r.failed),
  }));
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? Buffer.from(`${last.lastActivityAt}|${last.conversationId}`).toString('base64url') : null,
  };
};
const sourceSchema = z.array(z.object({ id: z.string().optional(), pageId: z.string(), title: z.string(), path: z.string() }));
export const queryAiConversation = async (s: AiConversationScope, conversationId: string) => {
  const { turns, feedback } = await read(s, {}, conversationId);
  turns.sort((a, b) => a.turn_index - b.turn_index);
  const first = turns[0];
  if (!first) return null;
  return {
    conversationId,
    language: first.language,
    startedAt: iso(first.occurred_at),
    visibility: first.visibility,
    turns: turns.map((t) => {
      const f = feedback.find((f) => f.turn_id === t.turn_id && f.rating);
      return {
        turnId: t.turn_id,
        turnIndex: t.turn_index,
        occurredAt: iso(t.occurred_at),
        question: t.content_captured ? t.question : null,
        rewrittenQuery: t.content_captured ? t.rewritten_query || null : null,
        answer: t.content_captured ? t.answer || null : null,
        status: t.status,
        noAnswerReason: t.no_answer_reason || null,
        citations: sourceSchema.parse(JSON.parse(t.citations)).map((c) => ({ id: c.id ?? '', title: c.title, path: c.path })),
        suggestions: sourceSchema.parse(JSON.parse(t.suggestions)).map((c) => ({ title: c.title, path: c.path })),
        pagePath: t.page_path || null,
        language: t.language,
        provider: t.provider || null,
        model: t.model || null,
        inputTokens: t.tokens_known ? Number(t.input_tokens) : null,
        outputTokens: t.tokens_known ? Number(t.output_tokens) : null,
        costUsd: t.cost_known ? Number(t.cost_micros) / 1e6 : null,
        latencyMs: t.latency_ms === null ? null : Number(t.latency_ms),
        feedback: f
          ? { rating: f.rating, reason: f.reason || null, comment: f.content_captured ? f.comment || null : null, updatedAt: iso(f.updated_at) }
          : null,
      };
    }),
  };
};
export const queryAiContentGaps = async (s: AiConversationScope, q: AiReadQuery) => {
  const rows = await archiveRows<{
    question: string;
    language: string;
    askedCount: Count;
    noAnswerCount: Count;
    downCount: Count;
    lastAskedAt: string;
    sampleConversationId: string;
  }>(
    `SELECT argMax(t.question,t.occurred_at) AS question,argMax(t.language,t.occurred_at) AS language,
 count() AS askedCount,countIf(t.status='no_answer') AS noAnswerCount,countIf(f.rating='down') AS downCount,
 max(t.occurred_at) AS lastAskedAt,argMax(t.conversation_id,t.occurred_at) AS sampleConversationId
 FROM (SELECT conversation_id,turn_id,question_key,question,language,status,occurred_at FROM ai_conversation_turns FINAL
 WHERE ${turnsWhere} AND content_captured=1 AND question_key!=toFixedString('',64)) AS t
 LEFT JOIN (${feedbackSource}) AS f ON t.turn_id=f.turn_id
 GROUP BY t.question_key HAVING noAnswerCount>0 OR downCount>0
 ORDER BY askedCount DESC,lastAskedAt DESC LIMIT {limit:UInt64}`,
    { ...archiveParams(s, q), limit: q.limit ?? 20 },
  );
  return {
    items: rows.map((r) => ({
      ...r,
      askedCount: Number(r.askedCount),
      noAnswerCount: Number(r.noAnswerCount),
      downCount: Number(r.downCount),
      lastAskedAt: iso(r.lastAskedAt),
      reason: Number(r.noAnswerCount) > 0 ? ('no_answer' as const) : ('low_rating' as const),
    })),
  };
};
export const emptyAiSummary = (range: '7d' | '30d' | '90d' = '30d') => ({
  range,
  totals: { conversations: 0, questions: 0, answered: 0, noAnswer: 0, failed: 0 },
  feedback: { up: 0, down: 0, reasons: [] as { reason: string; count: number }[] },
  usage: { inputTokens: 0, outputTokens: 0, costUsd: null as number | null, costComplete: false },
  timeseries: [] as {
    date: string;
    questions: number;
    answered: number;
    noAnswer: number;
    up: number;
    down: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number | null;
  }[],
  languages: [] as { language: string; questions: number }[],
});
interface UsageAggregate {
  inputTokens: Count;
  outputTokens: Count;
  costMicros: Count;
  knownCosts: Count;
}
interface TurnAggregate extends UsageAggregate {
  questions: Count;
  answered: Count;
  noAnswer: Count;
}
const usageSql = `sum(input_tokens) AS inputTokens,sum(output_tokens) AS outputTokens,
 sumIf(cost_micros,cost_known=1) AS costMicros,countIf(cost_known=1) AS knownCosts`;
const usageResult = (r: UsageAggregate) => ({
  inputTokens: Number(r.inputTokens),
  outputTokens: Number(r.outputTokens),
  costUsd: Number(r.knownCosts) > 0 ? Number(r.costMicros) / 1e6 : null,
});
export const queryAiConversationSummary = async (s: AiConversationScope, q: AiReadQuery) => {
  let timezone = 'UTC';
  try {
    timezone = new Intl.DateTimeFormat('en', { timeZone: q.timezone ?? 'UTC' }).resolvedOptions().timeZone;
  } catch {
    /* Invalid IANA zones use UTC. */
  }
  const queryParams = { ...archiveParams(s, q), timezone };
  const ctes = `WITH turns AS (SELECT conversation_id,turn_id,status,occurred_at,language,input_tokens,output_tokens,cost_micros,cost_known
 FROM ai_conversation_turns FINAL WHERE ${turnsWhere}),
 active AS (SELECT turn_id,rating,reason,updated_at FROM (${feedbackSource}) WHERE turn_id IN (SELECT turn_id FROM turns))`;
  const [totals, feedback, reasons, days, languages] = await Promise.all([
    archiveRows<TurnAggregate & { conversations: Count; failed: Count }>(
      `${ctes} SELECT uniqExact(conversation_id) AS conversations,
 count() AS questions,countIf(status='answered') AS answered,countIf(status='no_answer') AS noAnswer,
 countIf(status='failed') AS failed,${usageSql} FROM turns`,
      queryParams,
    ),
    archiveRows<{ up: Count; down: Count }>(`${ctes} SELECT countIf(rating='up') AS up,countIf(rating='down') AS down FROM active`, queryParams),
    archiveRows<{ reason: string; count: Count }>(`${ctes} SELECT reason,count() AS count FROM active WHERE reason!='' GROUP BY reason`, queryParams),
    archiveRows<TurnAggregate & { date: string; up: Count; down: Count }>(
      `${ctes},
 turn_days AS (SELECT toString(toDate(occurred_at,{timezone:String})) AS date,count() AS questions,
 countIf(status='answered') AS answered,countIf(status='no_answer') AS noAnswer,${usageSql} FROM turns GROUP BY date),
 feedback_days AS (SELECT toString(toDate(updated_at,{timezone:String})) AS date,
 countIf(rating='up') AS up,countIf(rating='down') AS down FROM active GROUP BY date)
 SELECT t.date AS date,t.questions AS questions,t.answered AS answered,t.noAnswer AS noAnswer,
 t.inputTokens AS inputTokens,t.outputTokens AS outputTokens,t.costMicros AS costMicros,t.knownCosts AS knownCosts,
 f.up AS up,f.down AS down FROM turn_days t LEFT JOIN feedback_days f ON t.date=f.date ORDER BY date`,
      queryParams,
    ),
    archiveRows<{ language: string; questions: Count }>(`${ctes} SELECT language,count() AS questions FROM turns GROUP BY language`, queryParams),
  ]);
  const out = emptyAiSummary(q.range);
  const t = totals[0];
  if (t) {
    out.totals = {
      conversations: Number(t.conversations),
      questions: Number(t.questions),
      answered: Number(t.answered),
      noAnswer: Number(t.noAnswer),
      failed: Number(t.failed),
    };
    out.usage = { ...usageResult(t), costComplete: Number(t.questions) > 0 && Number(t.knownCosts) === Number(t.questions) };
  }
  out.feedback = {
    up: Number(feedback[0]?.up ?? 0),
    down: Number(feedback[0]?.down ?? 0),
    reasons: reasons.map((r) => ({ reason: r.reason, count: Number(r.count) })),
  };
  out.timeseries = days.map((r) => ({
    date: r.date,
    questions: Number(r.questions),
    answered: Number(r.answered),
    noAnswer: Number(r.noAnswer),
    up: Number(r.up),
    down: Number(r.down),
    ...usageResult(r),
  }));
  out.languages = languages.map((r) => ({ language: r.language, questions: Number(r.questions) }));
  return out;
};
