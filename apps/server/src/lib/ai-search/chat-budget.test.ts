import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ eval: vi.fn() }));
vi.mock('./quota', () => ({ aiSpendRedis: async () => ({ eval: mocks.eval }) }));
vi.mock('@/lib/env-extras', () => ({
  envExtras: { SEARCH_CHAT_MAX_TURNS: 20, SEARCH_CHAT_MAX_CONVERSATION_TOKENS: 60_000, SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT: 2_000_000 },
}));

import { chatBudgetWarning, extendChatTurn, releaseChatTurn, reserveChatTurn, settleChatSpend } from './chat-budget';

const now = new Date('2026-11-06T10:00:00.000Z');
const keys = ['{search-chat:project-1}:conversation:conversation-1', '{search-chat:project-1}:tokens:2026-11-06'];

describe('chat budgets', () => {
  beforeEach(() => {
    mocks.eval.mockReset();
  });

  it('grows an admitted turn by what the budgets still have room for', async () => {
    mocks.eval.mockResolvedValue(1500);
    const hold = { reservedTokens: 9000, reservedAt: now };
    await expect(extendChatTurn('project-1', 'conversation-1', hold, 4000.2)).resolves.toBe(1500);
    expect(hold.reservedTokens).toBe(10_500);
    const [script, ...args] = mocks.eval.mock.calls[0] ?? [];
    expect(String(script)).toContain('math.min');
    expect(args).toEqual([2, ...keys, 4001, 60_000, 2_000_000, 86_400, 172_800]);
    mocks.eval.mockClear();
    await expect(extendChatTurn('project-1', 'conversation-1', hold, 0)).resolves.toBe(0);
    expect(mocks.eval).not.toHaveBeenCalled();
  });

  it('warns at startup about token budgets no full-size turn fits under', () => {
    const limits = {
      SEARCH_CHAT_HISTORY_MESSAGES: 6,
      SEARCH_CHAT_HISTORY_MAX_TOKENS: 1500,
      SEARCH_CHAT_MAX_CONVERSATION_TOKENS: 60_000,
      SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT: 2_000_000,
    };
    // The defaults fit several of the largest turns.
    expect(chatBudgetWarning(limits)).toBeNull();
    const low = chatBudgetWarning({ ...limits, SEARCH_CHAT_MAX_CONVERSATION_TOKENS: 5000, SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT: 9000 });
    expect(low).toEqual({
      settings: ['SEARCH_CHAT_MAX_CONVERSATION_TOKENS', 'SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT'],
      largestTurnTokens: expect.any(Number),
    });
    expect(low?.largestTurnTokens).toBeGreaterThan(9000);
    expect(limits.SEARCH_CHAT_MAX_CONVERSATION_TOKENS / (low?.largestTurnTokens ?? Number.POSITIVE_INFINITY)).toBeGreaterThan(2);
    // A longer history needs a larger reservation; 0 turns the daily budget off.
    const justFits = { ...limits, SEARCH_CHAT_MAX_CONVERSATION_TOKENS: (low?.largestTurnTokens ?? 0) + 1 };
    expect(chatBudgetWarning(justFits)).toBeNull();
    const longHistory = chatBudgetWarning({ ...justFits, SEARCH_CHAT_HISTORY_MAX_TOKENS: 16_000, SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT: 0 });
    expect(longHistory?.settings).toEqual(['SEARCH_CHAT_MAX_CONVERSATION_TOKENS']);
    expect(longHistory?.largestTurnTokens).toBeGreaterThan(low?.largestTurnTokens ?? Number.POSITIVE_INFINITY);
  });

  it('reserves a turn with its estimated tokens and reports the remaining allowance', async () => {
    mocks.eval.mockResolvedValue([1, 3, 0]);
    await expect(reserveChatTurn('project-1', 'conversation-1', 8000.4, now)).resolves.toEqual({
      allowed: true,
      turnIndex: 2,
      turnsRemaining: 17,
      reservedTokens: 8001,
      reservedAt: now,
    });
    const [script, keyCount, ...rest] = mocks.eval.mock.calls[0] ?? [];
    // Both keys share one per-project hash tag so the script is atomic in Dragonfly.
    expect([keyCount, ...rest]).toEqual([2, ...keys, 20, 60_000, 2_000_000, 86_400, 8001, 172_800]);
    // The reservation must fit under each cap, and is counted in the same atomic step as the turn.
    expect(script).toContain('tokens + reserve > tonumber(ARGV[2])');
    expect(script).toContain('daily + reserve > tonumber(ARGV[3])');
    expect(script).toMatch(/HINCRBY', KEYS\[1\], 'tokens', ARGV\[5\][\s\S]*INCRBY', KEYS\[2\], ARGV\[5\]/);
  });

  it.each([
    [[0, 20, 1], 'conversation_limit'],
    [[0, 4, 2], 'budget_exhausted'],
  ])('maps a refusal %j to %s', async (reply, reason) => {
    mocks.eval.mockResolvedValue(reply);
    await expect(reserveChatTurn('project-1', 'conversation-1', 5000, now)).resolves.toEqual({ allowed: false, reason });
  });

  it('fails closed when the counter store is unreachable', async () => {
    mocks.eval.mockRejectedValue(new Error('connection refused'));
    await expect(reserveChatTurn('project-1', 'conversation-1', 5000, now)).rejects.toThrow();
  });

  it('settles a turn by the difference between its spend and its reservation, on the reservation day', async () => {
    const hold = { reservedTokens: 5000, reservedAt: now };
    await settleChatSpend('project-1', 'conversation-1', hold, 5000);
    expect(mocks.eval).not.toHaveBeenCalled();
    await settleChatSpend('project-1', 'conversation-1', hold, 1200.2);
    // Settled after midnight: still the reservation's day key.
    await settleChatSpend('project-1', 'conversation-1', { ...hold, reservedAt: new Date('2026-11-06T23:59:59.000Z') }, 7000);
    expect(mocks.eval.mock.calls.map((call) => call.slice(1))).toEqual([
      [2, ...keys, -3799, 86_400, 172_800],
      [2, ...keys, 2000, 86_400, 172_800],
    ]);
  });

  it('gives the turn and its reservation back when a later gate refuses it', async () => {
    await releaseChatTurn('project-1', 'conversation-1', { reservedTokens: 5000, reservedAt: now });
    const [script, ...rest] = mocks.eval.mock.calls[0] ?? [];
    expect(rest).toEqual([2, ...keys, -5000, 86_400, 172_800]);
    expect(script).toMatch(/HINCRBY', KEYS\[1\], 'turns', -1/);
  });
});
