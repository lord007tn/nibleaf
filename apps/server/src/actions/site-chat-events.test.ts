import { analyticsPayloadSchema } from '@nibleaf/clickhouse';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ context: vi.fn(), track: vi.fn() }));
vi.mock('./sites', () => ({ resolvePublishedAnswerContext: mocks.context }));
vi.mock('./analytics', () => ({ trackProjectEvents: mocks.track }));

import { type AiChatServerEvent, chatAnalyticsPayload, recordAiChatEvents, recordSiteChatEvents } from './site-chat-events';

const conversationId = '00000000-0000-4000-8000-000000000001';
const turnId = '00000000-0000-4000-8000-000000000002';
const banner = { analytics: { cookieConsent: true, ga4: 'G-ABC123' } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.track.mockResolvedValue(undefined);
  mocks.context.mockResolvedValue({
    scope: { projectId: 'resolved', language: 'ar', visibility: 'private' },
    snapshot: { project: { config: banner } },
  });
});

describe('chat analytics payloads', () => {
  it.each<[AiChatServerEvent, Record<string, unknown>]>([
    [
      { name: 'chat_opened', conversationId, source: 'search_handoff' },
      { name: 'chat_opened', placement: 'search_handoff' },
    ],
    [
      { name: 'question_asked', conversationId, turnId, turnIndex: 2, followUp: true, pageContext: true },
      { name: 'chat_question_asked', outcomeReason: 'follow_up', placement: 'page_context' },
    ],
    [
      { name: 'first_token', conversationId, turnId, ttftMs: 812.6 },
      { name: 'chat_first_token', durationMs: 813 },
    ],
    [
      {
        name: 'answer_completed',
        conversationId,
        turnId,
        outcome: 'answered',
        provider: 'openrouter',
        model: 'openai/gpt-5.6-luna',
        inputTokens: 1200,
        outputTokens: 180,
        costUsd: 0.000_472,
        latencyMs: 2400,
        retrievalCacheHit: true,
      },
      {
        name: 'chat_answer_completed',
        outcomeReason: 'answered',
        promptTokens: 1200,
        completionTokens: 180,
        costMicros: 472,
        latencyMs: 2400,
        cacheStatus: 'hit',
      },
    ],
    [
      { name: 'answer_completed', conversationId, turnId, outcome: 'blocked', reason: 'quota_exhausted' },
      { name: 'chat_answer_completed', outcomeReason: 'blocked', noAnswerReason: 'quota_exhausted' },
    ],
    [
      { name: 'citation_clicked', conversationId, turnId, citationId: 'S2', position: 2 },
      { name: 'chat_citation_clicked', citationId: 'S2', citationPosition: 2 },
    ],
    [
      { name: 'follow_up_clicked', conversationId, turnId, position: 3 },
      { name: 'chat_follow_up_clicked', resultPosition: 3 },
    ],
    [
      { name: 'feedback_changed', conversationId, turnId, rating: null, previousRating: 'up' },
      { name: 'chat_feedback_changed', previousFeedback: 'helpful', target: 'answer' },
    ],
    [
      { name: 'quota_reached', conversationId, kind: 'token_budget' },
      { name: 'chat_quota_reached', outcomeReason: 'token_budget' },
    ],
    [
      { name: 'provider_error', conversationId, phase: 'follow_ups' },
      { name: 'chat_provider_error', outcomeReason: 'follow_ups' },
    ],
  ])('maps %o onto a valid content-free payload', (event, expected) => {
    const payload = chatAnalyticsPayload(event, 'ar');
    expect(analyticsPayloadSchema.parse(payload)).toMatchObject({ ...expected, conversationId, language: 'ar' });
    for (const content of ['question', 'answer', 'comment', 'text']) expect(payload).not.toHaveProperty(content);
  });
});

describe('reader chat events', () => {
  it('derives the project from the publication, trusts consent and forwards the reader', async () => {
    const body = { consent: 'not_required', sessionId: 'tab-1', events: [{ name: 'new_chat', conversationId }] } as const;
    expect(await recordSiteChatEvents('slug', { ...body, events: [...body.events] }, { userAgent: 'Mozilla/5.0', device: 'mobile' })).toEqual({
      recorded: 1,
    });
    // The site's banner applies, so a client cannot claim consent is not required.
    expect(mocks.track).toHaveBeenCalledWith(
      'resolved',
      [expect.objectContaining({ name: 'chat_new_chat', conversationId, language: 'ar' })],
      expect.objectContaining({ source: 'public_site', consentState: 'unknown', sessionId: 'tab-1', userAgent: 'Mozilla/5.0', device: 'mobile' }),
    );
  });

  it('rejects sites the reader cannot open before tracking', async () => {
    mocks.context.mockRejectedValueOnce(new Error('not found'));
    await expect(recordSiteChatEvents('unknown', { consent: 'unknown', events: [{ name: 'stop', conversationId }] })).rejects.toThrow('not found');
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it('never fails the caller when tracking fails', async () => {
    mocks.track.mockRejectedValueOnce(new Error('queue down'));
    await expect(recordAiChatEvents('project', { consent: 'granted' }, [{ name: 'stop', conversationId }])).resolves.toBeUndefined();
    await recordAiChatEvents('project', { consent: 'granted' }, []);
    expect(mocks.track).toHaveBeenCalledOnce();
  });
});
