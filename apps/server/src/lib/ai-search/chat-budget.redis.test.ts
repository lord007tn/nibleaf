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

  it('lets concurrent turns pass only while the daily budget has room', async () => {
    const projectId = `budget-test-${run}-concurrent`;
    const results = await Promise.all(Array.from({ length: 5 }, () => budget.reserveChatTurn(projectId, randomUUID(), 6000)));
    // 0 → 6,000 → 12,000: every later turn sees the first two reservations.
    expect(results.filter((result) => result.allowed)).toHaveLength(2);
    expect(results.every((result) => result.allowed || result.reason === 'budget_exhausted')).toBe(true);
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
