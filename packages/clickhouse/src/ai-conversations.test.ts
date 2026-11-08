import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildAiConversationQuery,
  deleteAiConversation,
  queryAiChatEngagement,
  queryAiContentGaps,
  queryAiConversation,
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
  cancelled: '1',
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
  it('returns saved citation sections and the turn version for transcript links', async () => {
    mocks.query.mockResolvedValueOnce(
      reply([
        {
          turn_id: 'turn',
          turn_index: 0,
          occurred_at: '2026-11-01T00:00:00Z',
          version_slug: 'v2',
          language: 'ar',
          visibility: 'public',
          content_captured: 1,
          question: 'How?',
          answer: 'Use settings [S1]',
          rewritten_query: '',
          status: 'answered',
          no_answer_reason: '',
          citations: JSON.stringify([{ id: 'S1', pageId: 'setup', title: 'Setup', path: 'setup', heading: 'Users', anchor: 'users' }]),
          suggestions: '[]',
          page_path: 'setup',
          provider: 'fixture',
          model: 'fixture',
          tokens_known: 0,
          cost_known: 0,
          latency_ms: null,
        },
      ]),
    );
    mocks.query.mockResolvedValueOnce(reply([]));
    expect(await queryAiConversation(scope, 'conversation')).toMatchObject({
      turns: [{ version: 'v2', citations: [{ id: 'S1', heading: 'Users', anchor: 'users' }] }],
    });
  });
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
    // Steered model output stays fast: long runs that almost match an email,
    // a phone number or a token, and far more text than is kept.
    const started = performance.now();
    for (const hostile of [
      `${'a'.repeat(20_000)}@${'b'.repeat(20_000)}`,
      `+1${' 1'.repeat(20_000)}x`,
      `${'a1'.repeat(20_000)}g`,
      'x'.repeat(5_000_000),
    ])
      redactReaderText(hostile);
    expect(performance.now() - started).toBeLessThan(500);
    expect(redactConversationText('Call +966 55 123 4567 or mail ana.b@acme-docs.example.sa')).toBe('Call [REDACTED] or mail [REDACTED]');
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
    expect(ai.map((migration) => migration.version)).toEqual([2_026_110_606, 2_026_110_607, 2_026_110_608]);
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
  it("re-aggregates only the deleted conversation's own days, read before the purge and inside retention", async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (_request: { query: string; query_params: Record<string, unknown> }) => {
        calls.push('days');
        return reply([{ day: '2026-11-01' }]);
      }),
      insert: async () => {
        calls.push('tombstone');
      },
      command: vi.fn(async ({ query }: { query: string }) => {
        calls.push(query.startsWith('INSERT INTO ai_usage_daily') ? 'refresh' : 'purge');
      }),
    };
    await deleteAiConversation(scope, 'c', client as never);
    expect(calls).toEqual(['tombstone', 'days', 'purge', 'purge', 'purge', 'refresh']);
    const daysQuery = client.query.mock.calls[0]?.[0] ?? { query: '', query_params: {} };
    expect(daysQuery.query).toContain('FROM ai_conversation_turns FINAL');
    expect(daysQuery.query).toContain('conversation_id={conversation:String}');
    expect(daysQuery.query).toContain("toDate(now64(3),'UTC') - {retention:UInt16}");
    expect(daysQuery.query_params).toMatchObject({ conversation: 'c', retention: 90 });
    const refresh = client.command.mock.calls.at(-1)?.[0] as unknown as { query_params: { days: string[] } };
    expect(refresh.query_params.days).toEqual(['2026-11-01']);
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
      cancelled: 1,
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
      .mockResolvedValueOnce(reply([{ language: 'ar', questions: '2' }]))
      // Spend counts every billed turn: a scripted turn on the 31st and a bot-only day.
      .mockResolvedValueOnce(
        reply([
          { date: '2026-11-01', turns: '1', inputTokens: '5', outputTokens: '5', costMicros: '100', knownCosts: '1' },
          { date: '2026-10-31', turns: '3', inputTokens: '17', outputTokens: '25', costMicros: '500', knownCosts: '1' },
        ]),
      );
    const result = await queryAiConversationSummary(scope, { timezone });
    // Reader counts stay people only.
    expect(result.totals).toEqual({ conversations: 1, questions: 2, answered: 1, noAnswer: 1, failed: 0 });
    expect(result.usage).toEqual({ inputTokens: 22, outputTokens: 30, costUsd: 0.0006, costComplete: false });
    expect(result.feedback).toEqual({ up: 1, down: 2, reasons: [{ reason: 'wrong', count: 2 }] });
    expect(result.timeseries).toMatchObject([
      { date: '2026-10-31', questions: 2, inputTokens: 17, costUsd: 0.0005 },
      { date: '2026-11-01', questions: 0, inputTokens: 5, costUsd: 0.0001 },
    ]);
    const spendQuery = mocks.query.mock.calls[5]?.[0].query as string;
    expect(spendQuery).toContain('count() AS turns');
    expect(spendQuery).not.toContain("actor_type='human'");
    expect(mocks.query.mock.calls[0]?.[0].query).toContain("actor_type='human'");
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

  describe('when conversations expire before their daily usage', () => {
    const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
    const rollup = (date: string, costMicros: number) => ({
      day: date,
      provider: 'openrouter',
      model: 'm',
      questions: 2,
      answered: 2,
      no_answer: 0,
      failed: 0,
      cancelled: 0,
      input_tokens: 100,
      output_tokens: 10,
      cost_micros: costMicros,
      cost_known_turns: 2,
      latency_ms_sum: 0,
      latency_turns: 0,
      first_token_ms_sum: 0,
      first_token_turns: 0,
      retrieval_cache_hits: 0,
    });
    // Totals, feedback, reasons, days, languages and spend from the stored turns; then the rollup.
    const stored = (turns: { date: string; costMicros: number }[], rollups: Record<string, unknown>[]) => {
      const spend = turns.map((turn) => ({
        date: turn.date,
        turns: '2',
        inputTokens: '100',
        outputTokens: '10',
        costMicros: String(turn.costMicros),
        knownCosts: '2',
      }));
      const totals = { conversations: String(turns.length), questions: String(2 * turns.length), answered: '0', noAnswer: '0', failed: '0' };
      mocks.query
        .mockResolvedValueOnce(reply([totals]))
        .mockResolvedValueOnce(reply([{ up: '0', down: '0' }]))
        .mockResolvedValueOnce(reply([]))
        .mockResolvedValueOnce(reply(turns.map((turn) => ({ date: turn.date, questions: '2', answered: '2', noAnswer: '0', up: '0', down: '0' }))))
        .mockResolvedValueOnce(reply([]))
        .mockResolvedValueOnce(reply(spend))
        .mockResolvedValueOnce(reply(rollups));
    };
    beforeEach(() => {
      vi.stubEnv('AI_CONVERSATION_RETENTION_DAYS', '30');
    });
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('keeps the spend of days whose conversations expired', async () => {
      stored([], [rollup(day(60), 1_000_000)]);
      const result = await queryAiConversationSummary(scope, { range: '90d' });
      expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 10, costUsd: 1, costComplete: false });
      expect(result.timeseries).toMatchObject([{ date: day(60), questions: 0, costUsd: 1 }]);
    });

    it('never calls cost complete for a range longer than conversations are kept', async () => {
      stored([{ date: day(1), costMicros: 500_000 }], [rollup(day(60), 1_000_000), rollup(day(1), 500_000)]);
      const result = await queryAiConversationSummary(scope, { range: '90d' });
      // $1 from the rollup of an expired day and $0.50 still stored: at least $1.50.
      expect(result.usage).toEqual({ inputTokens: 200, outputTokens: 20, costUsd: 1.5, costComplete: false });
      expect(result.timeseries.map((point) => point.date)).toEqual([day(60), day(1)]);
      // Within retention, the same day's fully reported spend is complete.
      stored([{ date: day(1), costMicros: 500_000 }], [rollup(day(1), 500_000)]);
      expect((await queryAiConversationSummary(scope, { range: '7d' })).usage).toMatchObject({ costUsd: 0.5, costComplete: true });
    });

    it('marks a local-time or language view of an expired range as incomplete', async () => {
      stored([{ date: day(1), costMicros: 500_000 }], []);
      const local = await queryAiConversationSummary(scope, { range: '90d', timezone: 'Asia/Riyadh' });
      expect(local.usage).toMatchObject({ costUsd: 0.5, costComplete: false });
    });
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
  // Spend counts every billed turn, scripted traffic included.
  expect(command.mock.calls[0]?.[0].query).not.toContain('actor_type');
  // A separate utility model gets its own per-model row.
  expect(command.mock.calls[0]?.[0].query).toContain('utility_model AS model');
  expect(command.mock.calls[0]?.[0].query).toContain("utility_model!=''");
  // Each model's cost counts on its own flag; a turn is fully costed only when both are known.
  expect(command.mock.calls[0]?.[0].query).toContain('sumIf(utility_cost_micros,utility_cost_known=1)');
  expect(command.mock.calls[0]?.[0].query).toContain("countIf(cost_known=1 AND (utility_model='' OR utility_cost_known=1)) AS cost_known_turns");
});
it('never rebuilds a day whose turns may have expired, even for a late write', async () => {
  const command = vi.fn();
  const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
  await refreshAiUsageDaily(scope, [day(90), day(120)], { command } as never);
  expect(command).not.toHaveBeenCalled();
  await refreshAiUsageDaily(scope, [day(120), day(89), day(0)], { command } as never);
  expect(command.mock.calls[0]?.[0].query_params.days).toEqual([day(89), day(0)]);
});
