import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aiConversationMigrations,
  buildAiConversationQuery,
  deleteAiConversation,
  queryAiContentGaps,
  queryAiConversationSummary,
  queryAiConversations,
} from './ai-conversations';
import { redactConversationText } from './redaction';

const mocks = vi.hoisted(() => ({ turns: [] as Record<string, unknown>[], feedback: [] as Record<string, unknown>[], query: vi.fn() }));
vi.mock('./client', () => ({ getClickHouseClient: () => ({ query: mocks.query }) }));
const scope = { tenantId: 'tenant', projectId: 'project' };
const turn = (extra: Record<string, unknown> = {}) => ({
  conversation_id: 'c',
  turn_id: 't',
  turn_index: 0,
  occurred_at: '2026-11-01 01:00:00.000',
  language: 'en',
  question: 'How?',
  question_key: 'a'.repeat(64),
  content_captured: 1,
  page_path: '/docs',
  status: 'answered',
  input_tokens: 10,
  output_tokens: 20,
  cost_known: 0,
  cost_micros: 0,
  ...extra,
});
beforeEach(() => {
  mocks.turns = [];
  mocks.feedback = [];
  mocks.query.mockImplementation(async ({ query }) => ({
    json: async () => (query.includes('FROM ai_conversation_turns') ? mocks.turns : mocks.feedback),
  }));
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
  it('uses additive idempotent migrations above the analytics range', () => {
    expect(aiConversationMigrations.every((m) => m.version >= 1001 && m.statements.every((s) => s.startsWith('CREATE TABLE IF NOT EXISTS')))).toBe(
      true,
    );
  });
  it('writes the tombstone before physical purges', async () => {
    const calls: string[] = [];
    const client = {
      insert: async () => {
        calls.push('tombstone');
      },
      command: async () => {
        calls.push('purge');
      },
    };
    await deleteAiConversation(scope, 'c', client as never);
    expect(calls).toEqual(['tombstone', 'purge', 'purge']);
  });
  it('filters captured text and pages with a stable cursor', async () => {
    mocks.turns = [
      turn(),
      turn({ conversation_id: 'b', turn_id: 'u', occurred_at: '2026-11-02 01:00:00.000' }),
      turn({ conversation_id: 'hidden', turn_id: 'v', content_captured: 0, question: 'How?' }),
    ];
    const first = await queryAiConversations(scope, { q: 'How', limit: 1 });
    expect(first.items[0]?.conversationId).toBe('b');
    expect(first.nextCursor).toBeTruthy();
    const next = await queryAiConversations(scope, { q: 'How', cursor: first.nextCursor ?? undefined, limit: 1 });
    expect(next.items.map((i) => i.conversationId)).toEqual(['c']);
  });
  it('counts every occurrence of a gap and selects the latest wording', async () => {
    mocks.turns = [turn({ status: 'no_answer' }), turn({ turn_id: 'u', question: 'How now?', occurred_at: '2026-11-02 01:00:00.000' })];
    expect((await queryAiContentGaps(scope, {})).items[0]).toMatchObject({
      askedCount: 2,
      noAnswerCount: 1,
      question: 'How now?',
      reason: 'no_answer',
    });
  });
  it('keeps unknown cost null and buckets by local date', async () => {
    mocks.turns = [turn()];
    const result = await queryAiConversationSummary(scope, { timezone: 'America/Los_Angeles' });
    expect(result.usage).toMatchObject({ costUsd: null, costComplete: false });
    expect(result.timeseries[0]).toMatchObject({ date: '2026-10-31', costUsd: null });
  });
});
