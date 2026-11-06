import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * The budget scripts against a real Redis/Dragonfly. Opt-in, like the ClickHouse
 * integration tests: run through the local services wrapper with
 * NIBLEAF_REDIS_TESTS=1. Every key belongs to throwaway projects and is deleted
 * afterwards; nothing else in the database is touched.
 */
const enabled = process.env.NIBLEAF_REDIS_TESTS === '1';
const run = randomUUID();

describe.skipIf(!enabled)('chat budgets (real Redis)', () => {
  let budget: typeof import('./chat-budget');
  let redis: Awaited<ReturnType<typeof import('./quota').aiSpendRedis>>;

  beforeAll(async () => {
    process.env.SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT = '10000';
    process.env.SEARCH_CHAT_MAX_CONVERSATION_TOKENS = '60000';
    budget = await import('./chat-budget');
    redis = await (await import('./quota')).aiSpendRedis();
  });
  afterAll(async () => {
    const keys = await redis.keys(`{search-chat:budget-test-${run}-*`);
    if (keys.length) await redis.del(...keys);
  });

  it('admits concurrent turns only while their reservations fit under the daily budget', async () => {
    const projectId = `budget-test-${run}-concurrent`;
    const results = await Promise.all(Array.from({ length: 5 }, () => budget.reserveChatTurn(projectId, randomUUID(), 4000)));
    // 4,000 + 4,000 fits in 10,000; a third would reach 12,000, so it and every later turn wait.
    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(results.every((result) => result.allowed || result.reason === 'budget_exhausted')).toBe(true);
    const daily = `{search-chat:${projectId}}:tokens:${new Date().toISOString().slice(0, 10)}`;
    expect(Number(await redis.get(daily))).toBe(8000);
  });

  it('grows an admitted turn only by what the budgets still have room for, even concurrently', async () => {
    const projectId = `budget-test-${run}-extend`;
    const conversationId = randomUUID();
    const daily = `{search-chat:${projectId}}:tokens:${new Date().toISOString().slice(0, 10)}`;
    const hold = await budget.reserveChatTurn(projectId, conversationId, 6000);
    if (!hold.allowed) throw new Error('expected the turn to be admitted');
    // The daily budget is 10,000: 6,000 reserved leaves room for 4,000.
    expect(await budget.extendChatTurn(projectId, conversationId, hold, 3000)).toBe(3000);
    expect(await budget.extendChatTurn(projectId, conversationId, hold, 3000)).toBe(1000);
    expect(await budget.extendChatTurn(projectId, conversationId, hold, 3000)).toBe(0);
    expect(hold.reservedTokens).toBe(10_000);
    expect(Number(await redis.get(daily))).toBe(10_000);
    // Settled to 2,000 spent: concurrent extensions share the 8,000 left, never more.
    await budget.settleChatSpend(projectId, conversationId, hold, 2000);
    const granted = await Promise.all(Array.from({ length: 5 }, () => budget.extendChatTurn(projectId, conversationId, { ...hold }, 3000)));
    expect(granted.reduce((sum, tokens) => sum + tokens, 0)).toBe(8000);
    expect(Number(await redis.get(daily))).toBe(10_000);
  });

  it('refuses a turn whose reservation alone would pass a cap', async () => {
    const projectId = `budget-test-${run}-oversized`;
    const daily = await budget.reserveChatTurn(projectId, randomUUID(), 10_001);
    expect(daily).toEqual({ allowed: false, reason: 'budget_exhausted' });
    const conversation = await budget.reserveChatTurn(projectId, randomUUID(), 60_001);
    expect(conversation).toEqual({ allowed: false, reason: 'conversation_limit' });
    expect(await redis.exists(`{search-chat:${projectId}}:tokens:${new Date().toISOString().slice(0, 10)}`)).toBe(0);
  });

  it('settles to actual spend, and a release never takes the counters below zero', async () => {
    const projectId = `budget-test-${run}-settle`;
    const conversationId = randomUUID();
    const held = await budget.reserveChatTurn(projectId, conversationId, 4000);
    if (!held.allowed) throw new Error('expected room in a fresh project');
    const daily = `{search-chat:${projectId}}:tokens:${held.reservedAt.toISOString().slice(0, 10)}`;
    const conversation = `{search-chat:${projectId}}:conversation:${conversationId}`;
    expect(Number(await redis.get(daily))).toBe(4000);
    await budget.settleChatSpend(projectId, conversationId, held, 1500);
    expect(Number(await redis.get(daily))).toBe(1500);
    expect(Number(await redis.hget(conversation, 'tokens'))).toBe(1500);
    await budget.releaseChatTurn(projectId, conversationId, { reservedTokens: 9000, reservedAt: held.reservedAt });
    expect(Number(await redis.get(daily))).toBe(0);
    expect(Number(await redis.hget(conversation, 'tokens'))).toBe(0);
    expect(Number(await redis.hget(conversation, 'turns'))).toBe(0);
  });
});
