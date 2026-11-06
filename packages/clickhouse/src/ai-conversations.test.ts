import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAiConversationQuery,
  deleteAiConversation,
  queryAiChatEngagement,
  queryAiContentGaps,
  queryAiConversationSummary,
  queryAiConversations,
  refreshAiUsageDaily,
} from './ai-conversations';
import { migrations } from './migrations';
import { redactConversationText, redactReaderText } from './redaction';
import { ANALYTICS_PROJECT_TABLES } from './tables';

const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('./client', () => ({ getClickHouseClient: () => ({ query: mocks.query }) }));
const scope = { tenantId: 'tenant', projectId: 'project' };
const aggregate = (extra: Record<string, unknown> = {}) => ({
  conversationId: 'b',
  startedAt: '2026-11-01 01:00:00.000',
  lastActivityAt: '2026-11-02 01:00:00.000',
  language: 'en',
  turns: '2',
  firstQuestion: null,
  answered: '1',
  noAnswer: '1',
  failed: '0',
  rating: 'mixed',
  pagePath: null,
  ...extra,
});
const reply = (rows: unknown[]) => ({ json: async () => rows });
beforeEach(() => {
  mocks.query.mockReset();
  mocks.query.mockResolvedValue(reply([]));
});
describe('AI archive', () => {
  it.each([
    'email me at reader@example.com',
    'Arabic \u0660\u0665\u0665\u0661\u0662\u0663\u0664\u0665\u0666\u0667',
    'Persian \u06f1\u06f2\u06f3\u06f4\u06f5\u06f6\u06f7\u06f8\u06f9',
    'Call +1 (555) 123-4567',
    'sk-secret123',
    'Bearer secret',
    'eyJhbGciOiJ.test.signature',
    'abcdef1234567890abcdef1234567890ab',
  ])('redacts %s', (value) => {
    expect(redactConversationText(value)).toContain('[REDACTED]');
  });
  it('strips URL query strings and fragments and caps text', () => {
    expect(redactConversationText('See https://docs.test/path?token=secret#private')).toBe('See https://docs.test/path');
    expect(redactConversationText('g'.repeat(17_000))).toHaveLength(16_000);
  });
  it('binds tenant and language and never interpolates user input', () => {
    const q = buildAiConversationQuery('ai_conversation_turns', scope, { language: "ar' OR 1=1", q: 'secret' });
    expect(q.query).not.toContain("ar' OR");
    expect(q.query_params.language).toBe("ar' OR 1=1");
    expect(q.query).toContain('FINAL');
    expect(q.query).toContain('ai_conversation_deletions FINAL');
  });
  it('appends date-versioned, idempotent AI chat migrations and registers every AI table', () => {
    const versions = migrations.map((migration) => migration.version);
    expect(new Set(versions).size).toBe(versions.length);
    const ai = migrations.filter((migration) => migration.version > 2_026_110_605);
    expect(ai.map((migration) => migration.version)).toEqual([2_026_110_606, 2_026_110_607]);
    expect(ai.flatMap((migration) => migration.statements).every((statement) => statement.includes('IF NOT EXISTS'))).toBe(true);
    const registered = new Map(ANALYTICS_PROJECT_TABLES.map((table) => [table.name, table]));
    expect(registered.get('ai_conversation_turns')).toMatchObject({ time: 'occurred_at', retention: 'conversation' });
    expect(registered.get('ai_conversation_feedback')).toMatchObject({ time: 'updated_at', retention: 'conversation' });
    expect(registered.get('ai_usage_daily')).toMatchObject({ time: 'day', retention: 'rollup' });
    expect(registered.get('ai_conversation_deletions')).toMatchObject({ preserve: true });
  });
  it('redacts links and long numbers only in text people type', () => {
    expect(redactReaderText('see https://acme.example/a?b=1 or www.acme.example, order 1234567')).toBe('see [URL] or [URL] order [REDACTED]');
    expect(redactConversationText('see https://docs.example/export?ref=1')).toBe('see https://docs.example/export');
  });
  it('writes the tombstone before physical purges', async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn().mockResolvedValue(reply([])),
      insert: async () => {
        calls.push('tombstone');
      },
      command: async () => {
        calls.push('purge');
      },
    };
    await deleteAiConversation(scope, 'c', client as never);
    expect(calls).toEqual(['tombstone', 'purge', 'purge', 'purge']);
  });
  it('binds list filters and cursor and maps bounded aggregate rows', async () => {
    mocks.query.mockResolvedValueOnce(reply([aggregate(), aggregate({ conversationId: 'a' })]));
    const first = await queryAiConversations(scope, { q: "How' OR 1=1", language: 'ar', status: 'failed', rating: 'down', limit: 1 });
    expect(first.items[0]).toMatchObject({
      conversationId: 'b',
      turns: 2,
      answered: 1,
      noAnswer: 1,
      failed: 0,
      firstQuestion: null,
      pagePath: null,
      rating: 'mixed',
      lastActivityAt: '2026-11-02T01:00:00.000Z',
    });
    expect(first.nextCursor).toBe(Buffer.from('2026-11-02T01:00:00.000Z|b').toString('base64url'));
    const call = mocks.query.mock.calls[0]?.[0];
    expect(call.query).not.toContain("How' OR");
    expect(call.query).not.toContain('SELECT *');
    expect(call.query).toContain('positionCaseInsensitiveUTF8');
    expect(call.query).toContain('ORDER BY lastActivityAt DESC,conversationId DESC');
    expect(call.query_params).toMatchObject({
      tenant: 'tenant',
      project: 'project',
      search: "How' OR 1=1",
      language: 'ar',
      rating: 'down',
      status: 'failed',
      fetchLimit: 2,
    });
    await queryAiConversations(scope, { cursor: first.nextCursor ?? undefined, limit: 1 });
    expect(mocks.query.mock.calls[1]?.[0].query_params).toMatchObject({ cursorDate: '2026-11-02T01:00:00.000Z', cursorId: 'b' });
  });
  it('rejects malformed cursors before querying', async () => {
    await expect(queryAiConversations(scope, { cursor: 'bad' })).rejects.toThrow();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('maps gap aggregates and excludes the empty FixedString key in SQL', async () => {
    mocks.query.mockResolvedValue(
      reply([
        {
          question: 'How now?',
          language: 'en',
          askedCount: '2',
          noAnswerCount: '1',
          downCount: '1',
          lastAskedAt: '2026-11-02 01:00:00.000',
          sampleConversationId: 'c',
        },
      ]),
    );
    expect((await queryAiContentGaps(scope, { limit: 3 })).items[0]).toMatchObject({
      askedCount: 2,
      noAnswerCount: 1,
      downCount: 1,
      question: 'How now?',
      reason: 'no_answer',
      lastAskedAt: '2026-11-02T01:00:00.000Z',
    });
    expect(mocks.query.mock.calls[0]?.[0].query).toContain("question_key!=toFixedString('',64)");
    expect(mocks.query.mock.calls[0]?.[0].query_params.limit).toBe(3);
  });
  it.each([
    ['America/Los_Angeles', 'America/Los_Angeles'],
    ['invalid/timezone', 'UTC'],
  ])('maps summary aggregates with timezone %s', async (timezone, expected) => {
    mocks.query
      .mockResolvedValueOnce(
        reply([
          {
            conversations: '1',
            questions: '2',
            answered: '1',
            noAnswer: '1',
            failed: '0',
            inputTokens: '10',
            outputTokens: '20',
            costMicros: '500',
            knownCosts: '1',
          },
        ]),
      )
      .mockResolvedValueOnce(reply([{ up: '1', down: '2' }]))
      .mockResolvedValueOnce(reply([{ reason: 'wrong', count: '2' }]))
      .mockResolvedValueOnce(
        reply([
          {
            date: '2026-10-31',
            questions: '2',
            answered: '1',
            noAnswer: '1',
            up: '1',
            down: '0',
            inputTokens: '10',
            outputTokens: '20',
            costMicros: '0',
            knownCosts: '0',
          },
        ]),
      )
      .mockResolvedValueOnce(reply([{ language: 'ar', questions: '2' }]));
    const result = await queryAiConversationSummary(scope, { timezone });
    expect(result.totals).toEqual({ conversations: 1, questions: 2, answered: 1, noAnswer: 1, failed: 0 });
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 20, costUsd: 0.0005, costComplete: false });
    expect(result.feedback).toEqual({ up: 1, down: 2, reasons: [{ reason: 'wrong', count: 2 }] });
    expect(result.timeseries[0]).toMatchObject({ date: '2026-10-31', questions: 2, costUsd: null });
    expect(result.languages).toEqual([{ language: 'ar', questions: 2 }]);
    for (const [call] of mocks.query.mock.calls) {
      if ('timezone' in call.query_params) expect(call.query_params.timezone).toBe(expected);
      expect(call.query).not.toContain('SELECT *');
      expect(call.query).toContain('ai_conversation_deletions FINAL');
    }
  });
  it('returns empty aggregates without inventing known cost', async () => {
    const result = await queryAiConversationSummary(scope, {});
    expect(result.usage.costUsd).toBeNull();
    expect(result.usage.costComplete).toBe(false);
  });
});

it('maps engagement medians, opens and counts without content', async () => {
  mocks.query.mockResolvedValue(
    reply([
      { event_name: 'chat_opened', source: 'launcher', n: '2', median: 0 },
      { event_name: 'chat_first_token', source: '', n: '1', median: 125 },
      { event_name: 'chat_citation_clicked', source: '', n: '3', median: 0 },
    ]),
  );
  const engagement = await queryAiChatEngagement(scope, {});
  const query = mocks.query.mock.calls.at(-1)?.[0];
  expect(query.query).toContain('FROM analytics_events FINAL');
  expect(query.query).toContain("actor_type = 'human'");
  expect(query.query_params.events).toContain('chat_opened');
  expect(engagement).toMatchObject({
    opens: 2,
    opensBySource: [{ source: 'launcher', count: 2 }],
    citationClicks: 3,
    medianFirstTokenMs: 125,
    medianLatencyMs: null,
  });
});
it('rebuilds exact rollups from FINAL rows and previous keys with bound days', async () => {
  const command = vi.fn();
  await refreshAiUsageDaily(scope, ['2026-11-01'], { command } as never);
  expect(command.mock.calls[0]?.[0].query).toContain('ai_conversation_turns FINAL');
  expect(command.mock.calls[0]?.[0].query).toContain('UNION ALL');
  expect(command.mock.calls[0]?.[0].query_params.days).toEqual(['2026-11-01']);
});
