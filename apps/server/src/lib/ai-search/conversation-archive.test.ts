import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { AI_CONVERSATION_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'), AI_CONVERSATION_RETENTION_DAYS: 90 },
  mode: 'clickhouse',
  createJob: vi.fn(),
}));
vi.mock('@nibleaf/database', () => ({ markAnalyticsStoragePending: async () => ({ accepted: true }) }));
vi.mock('@/env', () => ({ env: mocks.env }));
vi.mock('@nibleaf/bullmq', () => ({ createJob: mocks.createJob, QueueNames: { ANALYTICS: 'analytics' } }));
vi.mock('@nibleaf/clickhouse', async (original) => ({
  ...(await original<object>()),
  keys: () => ({ ANALYTICS_MODE: mocks.mode, ANALYTICS_HASH_SALT: 'test-only-salt' }),
}));

import {
  aiConversationCaptureReady,
  aiConversationContentAllowed,
  buildAiFeedbackRow,
  buildAiTurnRow,
  type ChatTurnCapture,
  recordAiChatEvents,
  recordAiChatTurn,
} from './conversation-archive';

const capture: ChatTurnCapture = {
  tenantId: 'tenant',
  projectId: 'project',
  conversationId: '00000000-0000-4000-8000-000000000001',
  turnId: '00000000-0000-4000-8000-000000000002',
  turnIndex: 0,
  occurredAt: new Date('2026-11-01T00:00:00.000Z'),
  deploymentId: 'd',
  versionSlug: 'v',
  language: 'ar',
  visibility: 'private',
  consent: 'granted',
  consentRequired: true,
  captureSetting: true,
  status: 'answered',
  question: 'Email reader@example.com',
  answer: 'Bearer secret',
  citations: [],
  suggestions: [],
  promptVersion: 'v1',
};
beforeEach(() => {
  mocks.mode = 'clickhouse';
  mocks.env.AI_CONVERSATION_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString('base64');
  vi.clearAllMocks();
});
describe('capture policy', () => {
  it.each(['denied', 'granted', 'not_required', 'unknown'] as const)('enforces consent %s', (consent) => {
    expect(aiConversationContentAllowed({ captureSetting: true, consent, consentRequired: true })).toBe(consent === 'granted');
    expect(aiConversationContentAllowed({ captureSetting: true, consent, consentRequired: false })).toBe(consent !== 'denied');
    expect(aiConversationContentAllowed({ captureSetting: false, consent, consentRequired: false })).toBe(false);
  });
  it('requires writes and a valid key for text', () => {
    mocks.mode = 'disabled';
    expect(aiConversationCaptureReady()).toBe(false);
    mocks.mode = 'clickhouse';
    mocks.env.AI_CONVERSATION_ENCRYPTION_KEY = '';
    expect(aiConversationCaptureReady()).toBe(false);
  });
  it('redacts row text and keeps unknown cost explicit', () => {
    const row = buildAiTurnRow(capture);
    expect(row.question).toBe('Email [REDACTED]');
    expect(row.answer).toBe('[REDACTED]');
    expect(row.question_key).toHaveLength(64);
    expect(row.cost_known).toBe(0);
    expect(row.expires_at).toBe('2027-01-30T00:00:00.000Z');
  });
  it('retains only content-free data without consent', () => {
    const row = buildAiTurnRow({ ...capture, consent: 'denied' });
    expect(row).toMatchObject({
      question: '',
      answer: '',
      rewritten_query: '',
      question_key: '',
      content_captured: 0,
      status: 'answered',
      visibility: 'private',
    });
  });
  it('withdraws feedback text and rating', () => {
    const row = buildAiFeedbackRow({ ...capture, rating: null, comment: 'private' });
    expect(row).toMatchObject({ rating: '', comment: '', reason: '' });
  });
  it('never rejects enqueue failures and skips disabled mode', async () => {
    mocks.createJob.mockRejectedValue(new Error('secret'));
    await expect(recordAiChatTurn(capture)).resolves.toBeUndefined();
    mocks.mode = 'disabled';
    mocks.createJob.mockClear();
    await recordAiChatTurn(capture);
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});

it('captures content-free events with scoped, consent-gated session hashes', async () => {
  const event = { name: 'chat_opened', conversationId: capture.conversationId, source: 'launcher' } as const;
  await recordAiChatEvents({ ...capture, sessionId: 'session1', consent: 'unknown' }, [event]);
  const first = mocks.createJob.mock.calls[0]?.[1].data.rows[0];
  expect(first.session_hash).toBeNull();
  expect(first).not.toHaveProperty('question');
  await recordAiChatEvents({ ...capture, sessionId: 'session1' }, [event]);
  await recordAiChatEvents({ ...capture, projectId: 'other', sessionId: 'session1' }, [event]);
  expect(mocks.createJob.mock.calls[1]?.[1].data.rows[0].session_hash).not.toBe(mocks.createJob.mock.calls[2]?.[1].data.rows[0].session_hash);
  mocks.createJob.mockRejectedValueOnce(new Error('private'));
  await expect(recordAiChatEvents(capture, [event])).resolves.toBeUndefined();
});
