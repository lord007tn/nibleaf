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
const groupBy = <T>(rows: T[], key: (row: T) => string): Map<string, [T, ...T[]]> => {
  const groups = new Map<string, [T, ...T[]]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = groups.get(k);
    if (bucket) bucket.push(row);
    else groups.set(k, [row]);
  }
  return groups;
};
const rating = (f: AiFeedbackRow[]) =>
  f.some((r) => r.rating === 'up')
    ? f.some((r) => r.rating === 'down')
      ? ('mixed' as const)
      : ('up' as const)
    : f.some((r) => r.rating === 'down')
      ? ('down' as const)
      : null;
export const queryAiConversations = async (s: AiConversationScope, q: AiReadQuery) => {
  const { turns, feedback } = await read(s, q);
  const groups = groupBy(turns, (t) => t.conversation_id);
  let items = [...groups]
    .map(([conversationId, rows]) => {
      rows.sort((a, b) => iso(a.occurred_at).localeCompare(iso(b.occurred_at)) || a.turn_index - b.turn_index);
      const first = rows[0];
      const last = rows.at(-1) ?? first;
      return {
        conversationId,
        startedAt: iso(first.occurred_at),
        lastActivityAt: iso(last.occurred_at),
        language: first.language,
        turns: rows.length,
        firstQuestion: first.content_captured ? first.question : null,
        answered: rows.filter((t) => t.status === 'answered').length,
        noAnswer: rows.filter((t) => t.status === 'no_answer').length,
        failed: rows.filter((t) => t.status === 'failed').length,
        rating: rating(feedback.filter((f) => f.conversation_id === conversationId)),
        pagePath: first.page_path || null,
      };
    })
    .filter(
      (i) =>
        (!q.status || turns.some((t) => t.conversation_id === i.conversationId && t.status === q.status)) &&
        (!q.rating || (q.rating === 'unrated' ? i.rating === null : i.rating === q.rating || i.rating === 'mixed')) &&
        (!q.q ||
          turns.some(
            (t) => t.conversation_id === i.conversationId && t.content_captured && t.question.toLowerCase().includes((q.q ?? '').toLowerCase()),
          )),
    );
  items.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt) || b.conversationId.localeCompare(a.conversationId));
  if (q.cursor) {
    const [date, id] = z.tuple([z.iso.datetime(), z.string().min(1)]).parse(Buffer.from(q.cursor, 'base64url').toString().split('|'));
    items = items.filter((i) => i.lastActivityAt < date || (i.lastActivityAt === date && i.conversationId < id));
  }
  const limit = q.limit ?? 25;
  const more = items.length > limit;
  items = items.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: more && last ? Buffer.from(`${last.lastActivityAt}|${last.conversationId}`).toString('base64url') : null };
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
  const { turns, feedback } = await read(s, q);
  const down = new Set(feedback.filter((f) => f.rating === 'down').map((f) => f.turn_id));
  return {
    items: [
      ...groupBy(
        turns.filter((t) => t.content_captured && t.question_key.replace(/\0/gu, '')),
        (t) => t.question_key,
      ),
    ]
      .map(([, rows]) => {
        rows.sort((a, b) => iso(b.occurred_at).localeCompare(iso(a.occurred_at)));
        const t = rows[0];
        const noAnswerCount = rows.filter((t) => t.status === 'no_answer').length;
        return {
          question: t.question,
          language: t.language,
          askedCount: rows.length,
          noAnswerCount,
          downCount: rows.filter((t) => down.has(t.turn_id)).length,
          lastAskedAt: iso(t.occurred_at),
          sampleConversationId: t.conversation_id,
          reason: noAnswerCount ? ('no_answer' as const) : ('low_rating' as const),
        };
      })
      .filter((g) => g.noAnswerCount > 0 || g.downCount > 0)
      .sort((a, b) => b.askedCount - a.askedCount || b.lastAskedAt.localeCompare(a.lastAskedAt))
      .slice(0, q.limit ?? 20),
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
export const queryAiConversationSummary = async (s: AiConversationScope, q: AiReadQuery) => {
  const { turns, feedback } = await read(s, q);
  const out = emptyAiSummary(q.range);
  const active = feedback.filter((f) => f.rating && turns.some((t) => t.turn_id === f.turn_id));
  out.totals = {
    conversations: new Set(turns.map((t) => t.conversation_id)).size,
    questions: turns.length,
    answered: turns.filter((t) => t.status === 'answered').length,
    noAnswer: turns.filter((t) => t.status === 'no_answer').length,
    failed: turns.filter((t) => t.status === 'failed').length,
  };
  out.feedback = {
    up: active.filter((f) => f.rating === 'up').length,
    down: active.filter((f) => f.rating === 'down').length,
    reasons: [
      ...groupBy(
        active.filter((f) => f.reason),
        (f) => f.reason,
      ),
    ].map(([reason, rows]) => ({ reason, count: rows.length })),
  };
  const usage = (rows: AiTurnRow[]) => ({
    inputTokens: rows.reduce((n, t) => n + Number(t.input_tokens), 0),
    outputTokens: rows.reduce((n, t) => n + Number(t.output_tokens), 0),
    costUsd: rows.some((t) => t.cost_known) ? rows.reduce((n, t) => n + (t.cost_known ? Number(t.cost_micros) : 0), 0) / 1e6 : null,
  });
  out.usage = { ...usage(turns), costComplete: turns.length > 0 && turns.every((t) => Boolean(t.cost_known)) };
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: q.timezone ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
  const day = (value: string) => formatter.format(new Date(iso(value)));
  out.timeseries = [...groupBy(turns, (t) => day(t.occurred_at))]
    .map(([date, rows]) => ({
      date,
      questions: rows.length,
      answered: rows.filter((t) => t.status === 'answered').length,
      noAnswer: rows.filter((t) => t.status === 'no_answer').length,
      up: active.filter((f) => f.rating === 'up' && day(f.updated_at) === date).length,
      down: active.filter((f) => f.rating === 'down' && day(f.updated_at) === date).length,
      ...usage(rows),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  out.languages = [...groupBy(turns, (t) => t.language)].map(([language, rows]) => ({ language, questions: rows.length }));
  return out;
};
