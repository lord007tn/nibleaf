import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type AiTurnRow,
  deleteAiConversation,
  deleteProjectAiConversations,
  queryAiChatEngagement,
  queryAiContentGaps,
  queryAiConversationSummary,
  queryAiConversations,
  queryAiUsageDaily,
  refreshAiUsageDaily,
} from './ai-conversations';
import { eventToClickHouseRow, getClickHouseClient } from './client';
import { buildAnalyticsEvent } from './events';

// Never run synthetic writes against a default or production database.
const integration = process.env.CLICKHOUSE_URL ? describe : describe.skip;
integration('AI archive SQL integration', () => {
  it('aggregates isolated fixtures, filters and pages without leaking deleted content', async () => {
    // Synthetic rows go to a dedicated database (CI's or a local namespace), never the server default.
    expect(process.env.CLICKHOUSE_DATABASE ?? 'default').not.toBe('default');
    const client = getClickHouseClient('writer');
    const tenant = randomUUID();
    const project = randomUUID();
    const scope = { tenantId: tenant, projectId: project };
    const c1 = randomUUID(),
      c2 = randomUUID(),
      hidden = randomUUID(),
      deleted = randomUUID();
    const day = new Date(Date.now() - 3 * 86_400_000);
    day.setUTCHours(1, 0, 0, 0);
    const at = (hours: number) => new Date(day.getTime() + hours * 3_600_000).toISOString();
    const base: AiTurnRow = {
      tenant_id: tenant,
      project_id: project,
      conversation_id: c1,
      turn_id: randomUUID(),
      turn_index: 0,
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      occurred_at: at(0),
      received_at: at(0),
      deployment_id: 'test',
      version_slug: 'test',
      language: 'en',
      visibility: 'public',
      consent_state: 'granted',
      content_captured: 1,
      session_hash: null,
      page_path: '/docs',
      status: 'answered',
      no_answer_reason: '',
      question: 'How?',
      rewritten_query: '',
      answer: 'answer',
      question_key: 'a'.repeat(64),
      citations: '[]',
      suggestions: '[]',
      provider: 'test',
      model: 'test',
      prompt_version: 'test',
      input_tokens: 10,
      output_tokens: 20,
      tokens_known: 1,
      cost_micros: 1000,
      cost_known: 1,
      latency_ms: null,
      first_token_ms: null,
      retrieval_confidence: 0,
      chunk_count: 0,
    };
    const turns: AiTurnRow[] = [
      base,
      { ...base, turn_id: randomUUID(), turn_index: 1, occurred_at: at(1), status: 'no_answer', question: 'HOW now?', cost_known: 0 },
      {
        ...base,
        conversation_id: c2,
        turn_id: randomUUID(),
        occurred_at: at(24),
        language: 'ar',
        utility_model: 'test-mini',
        utility_input_tokens: 5,
        utility_output_tokens: 2,
        utility_cost_micros: 100,
        question: '\u0643\u064a\u0641 \u0623\u0628\u062f\u0623\u061f',
        question_key: 'b'.repeat(64),
      },
      {
        ...base,
        conversation_id: hidden,
        turn_id: randomUUID(),
        occurred_at: at(24),
        cost_known: 0,
        content_captured: 0,
        question: '',
        question_key: '',
        page_path: '',
        status: 'failed',
      },
      { ...base, conversation_id: deleted, turn_id: randomUUID() },
      { ...base, turn_id: randomUUID(), occurred_at: at(26), question_key: '', status: 'no_answer' },
    ];
    const feedback = (index: number, rating: 'up' | 'down' | '', hours: number, reason = '') => {
      const turn = turns[index];
      if (!turn) throw new Error('Missing fixture turn');
      return {
        tenant_id: tenant,
        project_id: project,
        conversation_id: turn.conversation_id,
        turn_id: turn.turn_id,
        expires_at: base.expires_at,
        rating,
        reason,
        comment: '',
        content_captured: 1,
        language: 'en',
        consent_state: 'granted',
        created_at: at(0),
        updated_at: at(hours),
      };
    };
    const oldTurn = { ...base, conversation_id: randomUUID(), turn_id: randomUUID(), occurred_at: at(-90 * 24) };
    // A scripted reader: billed like anyone, but not a person in reader metrics.
    const botTurn: AiTurnRow = {
      ...base,
      conversation_id: randomUUID(),
      turn_id: randomUUID(),
      occurred_at: at(24),
      actor_type: 'bot',
      input_tokens: 7,
      output_tokens: 3,
      cost_micros: 1000,
    };
    // A usage day older than conversation retention: its turns are gone, its spend must stay.
    const pastDay = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10);
    try {
      await client.insert({
        table: 'ai_conversation_turns',
        format: 'JSONEachRow',
        values: [
          ...turns,
          botTurn,
          oldTurn,
          { ...base, conversation_id: randomUUID(), turn_id: randomUUID(), expires_at: at(-1) },
          { ...base, project_id: randomUUID(), conversation_id: randomUUID(), turn_id: randomUUID() },
        ],
      });
      await client.insert({
        table: 'ai_conversation_feedback',
        format: 'JSONEachRow',
        values: [
          feedback(0, 'up', 2),
          feedback(1, 'down', 25, 'wrong'),
          feedback(2, 'down', 24, 'withdrawn'),
          feedback(2, '', 25),
          { ...feedback(0, 'down', 25, 'old turn'), conversation_id: oldTurn.conversation_id, turn_id: oldTurn.turn_id },
          feedback(4, 'down', 25, 'deleted'),
          { ...feedback(3, 'down', 25, 'expired'), expires_at: at(-1) },
        ],
      });
      await client.insert({
        table: 'ai_conversation_deletions',
        format: 'JSONEachRow',
        values: [{ tenant_id: tenant, project_id: project, conversation_id: deleted, deleted_at: at(0) }],
      });
      // Chat events travel the shared analytics_events pipeline; a retried insert is deduplicated.
      const context = {
        tenantId: tenant,
        projectId: project,
        siteId: project,
        source: 'public_site' as const,
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150.0 Safari/537.36',
        privacy: { visibility: 'public' as const, allowCampaignDimensions: false, allowRawPublicSearchQueries: false },
        hashSalt: 'integration-only-salt',
      };
      const firstToken = eventToClickHouseRow(
        buildAnalyticsEvent(
          {
            consentState: 'unknown',
            occurredAt: at(0),
            payload: { name: 'chat_first_token', conversationId: c1, turnId: base.turn_id, durationMs: 125 },
          },
          context,
        ),
      );
      const bot = eventToClickHouseRow(
        buildAnalyticsEvent(
          { consentState: 'unknown', occurredAt: at(0), payload: { name: 'chat_first_token', conversationId: c2, durationMs: 9000 } },
          { ...context, userAgent: 'GPTBot/1.2' },
        ),
      );
      await client.insert({ table: 'analytics_events', format: 'JSONEachRow', values: [firstToken, firstToken, bot] });
      expect((await queryAiChatEngagement(scope, {})).medianFirstTokenMs).toBe(125);
      const days = [at(0).slice(0, 10), at(24).slice(0, 10)];
      await refreshAiUsageDaily(scope, days, client);
      await refreshAiUsageDaily(scope, days, client);
      const usage = await queryAiUsageDaily(scope, {});
      // Usage counts every billed turn, the scripted one included, and attributes
      // the utility model's tokens to it, not to the answer model.
      expect(usage.reduce((n, r) => n + Number(r.questions), 0)).toBe(6);
      expect(usage.reduce((n, r) => n + Number(r.input_tokens), 0)).toBe(62);
      expect(usage.find((r) => r.model === 'test-mini')).toMatchObject({ questions: 0, input_tokens: 5, output_tokens: 2, cost_micros: 100 });
      expect(usage.filter((r) => r.model === 'test').reduce((n, r) => n + Number(r.input_tokens), 0)).toBe(57);
      await client.insert({
        table: 'ai_usage_daily',
        format: 'JSONEachRow',
        values: [
          {
            tenant_id: tenant,
            project_id: project,
            day: pastDay,
            provider: 'test',
            model: 'test',
            questions: 7,
            answered: 7,
            no_answer: 0,
            failed: 0,
            cancelled: 0,
            input_tokens: 700,
            output_tokens: 70,
            cost_micros: 7000,
            cost_known_turns: 7,
            latency_ms_sum: 0,
            latency_turns: 0,
            first_token_ms_sum: 0,
            first_token_turns: 0,
            retrieval_cache_hits: 0,
            updated_at: at(0),
          },
        ],
      });
      const all = await queryAiConversations(scope, {});
      expect(all.items).toHaveLength(3);
      expect(all.items.map((r) => r.conversationId)).not.toContain(deleted);
      expect(all.items.find((r) => r.conversationId === hidden)).toMatchObject({ firstQuestion: null, pagePath: null });
      expect(all.items.find((r) => r.conversationId === c1)).toMatchObject({ rating: 'mixed', firstQuestion: 'How?', pagePath: '/docs', turns: 3 });
      expect((await queryAiConversations(scope, { q: 'hOw' })).items.map((r) => r.conversationId)).toEqual([c1]);
      expect((await queryAiConversations(scope, { q: '\u0643\u064a\u0641', language: 'ar' })).items.map((r) => r.conversationId)).toEqual([c2]);
      expect((await queryAiConversations(scope, { rating: 'up' })).items.map((r) => r.conversationId)).toEqual([c1]);
      expect((await queryAiConversations(scope, { rating: 'down', status: 'no_answer' })).items.map((r) => r.conversationId)).toEqual([c1]);
      expect((await queryAiConversations(scope, { rating: 'unrated' })).items.map((r) => r.conversationId).sort()).toEqual([c2, hidden].sort());
      const first = await queryAiConversations(scope, { limit: 1 });
      expect(first.nextCursor).toBeTruthy();
      const second = await queryAiConversations(scope, { limit: 1, cursor: first.nextCursor ?? undefined });
      const third = await queryAiConversations(scope, { limit: 1, cursor: second.nextCursor ?? undefined });
      expect([...first.items, ...second.items, ...third.items].map((r) => r.conversationId)).toEqual(all.items.map((r) => r.conversationId));
      expect(third.nextCursor).toBeNull();
      const summary = await queryAiConversationSummary(scope, { timezone: 'America/Los_Angeles' });
      // Reader counts are people only; tokens and cost include the scripted turn.
      expect(summary.totals).toEqual({ conversations: 3, questions: 5, answered: 2, noAnswer: 2, failed: 1 });
      expect(summary.feedback).toEqual({ up: 1, down: 1, reasons: [{ reason: 'wrong', count: 1 }] });
      expect(summary.usage).toEqual({ inputTokens: 62, outputTokens: 105, costUsd: 0.0041, costComplete: false });
      const localDay = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(day);
      expect(summary.timeseries.find((r) => r.date === localDay)).toMatchObject({ questions: 2, up: 1, down: 0, costUsd: 0.001 });
      expect(summary.timeseries.reduce((n, r) => n + r.down, 0)).toBe(1);
      expect(summary.languages.sort((a, b) => a.language.localeCompare(b.language))).toEqual([
        { language: 'ar', questions: 1 },
        { language: 'en', questions: 4 },
      ]);
      expect((await queryAiConversationSummary(scope, { language: 'en' })).usage.costComplete).toBe(false);
      const unknown = await queryAiConversationSummary(scope, { language: 'ar', timezone: 'invalid/zone' });
      expect(unknown.usage.costComplete).toBe(true);
      expect(unknown.timeseries[0]?.date).toBe(at(24).slice(0, 10));
      expect((await queryAiContentGaps(scope, {})).items).toEqual([
        {
          question: 'HOW now?',
          language: 'en',
          askedCount: 2,
          noAnswerCount: 1,
          downCount: 1,
          lastAskedAt: at(1),
          sampleConversationId: c1,
          reason: 'no_answer',
        },
      ]);
      const gapProject = randomUUID();
      const gapTurn = { ...base, project_id: gapProject, cost_known: 0, turn_id: randomUUID() };
      await client.insert({ table: 'ai_conversation_turns', format: 'JSONEachRow', values: [gapTurn] });
      await client.insert({
        table: 'ai_conversation_feedback',
        format: 'JSONEachRow',
        values: [{ ...feedback(0, 'down', 2), project_id: gapProject, turn_id: gapTurn.turn_id }],
      });
      const gapScope = { tenantId: tenant, projectId: gapProject };
      expect((await queryAiContentGaps(gapScope, { limit: 1 })).items[0]).toMatchObject({
        reason: 'low_rating',
        askedCount: 1,
        noAnswerCount: 0,
        downCount: 1,
      });
      expect((await queryAiConversationSummary(gapScope, {})).usage).toMatchObject({ costUsd: null, costComplete: false });
      await deleteAiConversation(scope, c1, client);
      expect((await queryAiChatEngagement(scope, {})).medianFirstTokenMs).toBeNull();
      // c2, the hidden conversation and the scripted turn remain.
      expect((await queryAiUsageDaily(scope, {})).reduce((n, r) => n + Number(r.questions), 0)).toBe(3);
      // Deleting one conversation never rebuilds days whose turns have expired.
      const past = await client.query({
        query:
          'SELECT sum(questions) AS questions FROM ai_usage_daily FINAL WHERE tenant_id={tenant:String} AND project_id={project:String} AND day={day:Date}',
        query_params: { tenant, project, day: pastDay },
        format: 'JSONEachRow',
      });
      expect(Number((await past.json<{ questions: string }>())[0]?.questions)).toBe(7);
      // A project-wide tombstone must exclude both sources even when facts still exist.
      await client.insert({
        table: 'ai_conversation_deletions',
        format: 'JSONEachRow',
        values: [{ tenant_id: tenant, project_id: project, conversation_id: '', deleted_at: at(0) }],
      });
      expect((await queryAiConversations(scope, {})).items).toEqual([]);
      expect((await queryAiConversationSummary(scope, {})).totals.questions).toBe(0);
      expect((await queryAiContentGaps(scope, {})).items).toEqual([]);
      await deleteProjectAiConversations(tenant, project);
      expect(await queryAiUsageDaily(scope, {})).toEqual([]);
    } finally {
      for (const table of ['ai_conversation_turns', 'ai_conversation_feedback', 'analytics_events', 'ai_usage_daily', 'ai_conversation_deletions']) {
        await client.command({
          query: `ALTER TABLE ${table} DELETE WHERE tenant_id={tenant:String} SETTINGS mutations_sync=2`,
          query_params: { tenant },
        });
      }
    }
  }, 60_000);
});
