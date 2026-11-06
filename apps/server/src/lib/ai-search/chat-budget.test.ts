import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ eval: vi.fn() }));
vi.mock('./quota', () => ({ aiSpendRedis: async () => ({ eval: mocks.eval }) }));
vi.mock('@/lib/env-extras', () => ({
  envExtras: { SEARCH_CHAT_MAX_TURNS: 20, SEARCH_CHAT_MAX_CONVERSATION_TOKENS: 60_000, SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT: 2_000_000 },
}));

import { recordChatSpend, releaseChatTurn, reserveChatTurn } from './chat-budget';

const now = new Date('2026-11-06T10:00:00.000Z');

describe('chat budgets', () => {
  beforeEach(() => {
    mocks.eval.mockReset();
  });

  it('reserves a turn and reports the remaining allowance', async () => {
    mocks.eval.mockResolvedValue([1, 3, 0]);
    await expect(reserveChatTurn('project-1', 'conversation-1', now)).resolves.toEqual({ allowed: true, turnIndex: 2, turnsRemaining: 17 });
    const [, keyCount, conversationKey, tokensKey, ...limits] = mocks.eval.mock.calls[0] ?? [];
    expect(keyCount).toBe(2);
    // Both keys share one per-project hash tag so the script is atomic in Dragonfly.
    expect(conversationKey).toBe('{search-chat:project-1}:conversation:conversation-1');
    expect(tokensKey).toBe('{search-chat:project-1}:tokens:2026-11-06');
    expect(limits).toEqual([20, 60_000, 2_000_000, 86_400]);
  });

  it.each([
    [[0, 20, 1], 'conversation_limit'],
    [[0, 4, 2], 'budget_exhausted'],
  ])('maps a refusal %j to %s', async (reply, reason) => {
    mocks.eval.mockResolvedValue(reply);
    await expect(reserveChatTurn('project-1', 'conversation-1', now)).resolves.toEqual({ allowed: false, reason });
  });

  it('fails closed when the counter store is unreachable', async () => {
    mocks.eval.mockRejectedValue(new Error('connection refused'));
    await expect(reserveChatTurn('project-1', 'conversation-1', now)).rejects.toThrow();
  });

  it('records spend against the conversation and the project day, ignoring zero', async () => {
    await recordChatSpend('project-1', 'conversation-1', 0, now);
    expect(mocks.eval).not.toHaveBeenCalled();
    await recordChatSpend('project-1', 'conversation-1', 120.2, now);
    expect(mocks.eval.mock.calls[0]?.slice(1)).toEqual([
      2,
      '{search-chat:project-1}:conversation:conversation-1',
      '{search-chat:project-1}:tokens:2026-11-06',
      121,
      86_400,
      172_800,
    ]);
  });

  it('can undo a reservation', async () => {
    await releaseChatTurn('project-1', 'conversation-1', now);
    expect(mocks.eval.mock.calls[0]?.slice(1)).toEqual([1, '{search-chat:project-1}:conversation:conversation-1']);
  });
});
