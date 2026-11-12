import { Redis } from 'ioredis';
import { env } from '@/env';

let redis: Redis | null = null;
let connecting: Promise<Redis> | null = null;

/** Shared bounded connection for AI spend counters (answer quota, chat budgets). */
export const aiSpendRedis = (): Promise<Redis> => {
  if (redis?.status === 'ready') return Promise.resolve(redis);
  if (connecting) return connecting;
  redis?.disconnect();
  const client = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    protocol: 2,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    commandTimeout: 2000,
    retryStrategy: () => null,
  });
  redis = client;
  client.on('error', () => undefined);
  // Offline buffering stays disabled, but concurrent first requests must wait
  // for the same bounded connection attempt before sending quota commands.
  connecting = client
    .connect()
    .then(() => client)
    .finally(() => {
      connecting = null;
    });
  return connecting;
};

const day = (now: Date): string => now.toISOString().slice(0, 10);

/** Requests the daily quota counted for a project and UTC day (spend enforcement). */
const quotaKey = (projectId: string, now: Date) => `{search-answer-quota}:${projectId}:${day(now)}`;

/** Redis-backed project quota. Fail closed when the shared counter is
 * unavailable so a Redis outage cannot turn into unbounded provider spend. */
export const consumeAnswerQuota = async (projectId: string, now = new Date()): Promise<{ allowed: boolean; remaining: number }> => {
  const limit = env.SEARCH_ANSWER_DAILY_PER_PROJECT;
  if (limit === 0) return { allowed: false, remaining: 0 };
  const key = quotaKey(projectId, now);
  const client = await aiSpendRedis();
  const current = Number(
    await client.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],172800) end; return n", 1, key),
  );
  return { allowed: current <= limit, remaining: Math.max(0, limit - current) };
};

/** Completed answers per project and UTC day, for display only; spend is enforced by the quota key above. */
const servedKey = (projectId: string, now: Date) => `{search-answer-served}:${projectId}:${day(now)}`;

/**
 * Counts one answer that reached the reader (an answer, or a grounded "no
 * answer"), after generation succeeded. The quota counter is spent before
 * generating, so it also counts failures; this one doesn't. Best effort: a
 * Redis hiccup never fails the reader's answer.
 */
export const recordAnswerServed = async (projectId: string, now = new Date()): Promise<void> => {
  try {
    const client = await aiSpendRedis();
    await client.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],172800) end; return n",
      1,
      servedKey(projectId, now),
    );
  } catch {
    // Display only.
  }
};

/** A counter's value, or null when it is not a usable count. */
const count = (raw: string | null) => {
  const value = raw === null ? 0 : Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
};

/**
 * Today's answer counts for a project, for the AI answers page, read without
 * spending one (one MGET, the UTC day `consumeAnswerQuota` uses):
 * - `answersToday`: completed answers, for display;
 * - `spent`: requests the daily quota counted, failed generations included. Readers
 *   are refused once it reaches `limit`, so the limit state is decided from it.
 * Both are null when the counters can't be read; it never fails the page.
 */
export const readAnswerQuota = async (
  projectId: string,
  now = new Date(),
): Promise<{ answersToday: number | null; spent: number | null; limit: number; resetsAt: string }> => {
  const limit = env.SEARCH_ANSWER_DAILY_PER_PROJECT;
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  try {
    const client = await aiSpendRedis();
    const [served, spent] = await client.mget(servedKey(projectId, now), quotaKey(projectId, now));
    return { answersToday: count(served ?? null), spent: count(spent ?? null), limit, resetsAt };
  } catch {
    return { answersToday: null, spent: null, limit, resetsAt };
  }
};
