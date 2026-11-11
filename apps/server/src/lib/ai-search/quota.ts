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

/** Redis-backed project quota. Fail closed when the shared counter is
 * unavailable so a Redis outage cannot turn into unbounded provider spend. */
export const consumeAnswerQuota = async (projectId: string, now = new Date()): Promise<{ allowed: boolean; remaining: number }> => {
  const limit = env.SEARCH_ANSWER_DAILY_PER_PROJECT;
  if (limit === 0) return { allowed: false, remaining: 0 };
  const key = `{search-answer-quota}:${projectId}:${day(now)}`;
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

/**
 * Today's completed answers for a project, for the AI answers page, read
 * without spending one. Null when the counter can't be read; it never fails
 * the page. The day is UTC, matching `consumeAnswerQuota`.
 */
export const readAnswerQuota = async (
  projectId: string,
  now = new Date(),
): Promise<{ answersToday: number | null; limit: number; resetsAt: string }> => {
  const limit = env.SEARCH_ANSWER_DAILY_PER_PROJECT;
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
  try {
    const client = await aiSpendRedis();
    const raw = await client.get(servedKey(projectId, now));
    const counted = raw === null ? 0 : Number(raw);
    return { answersToday: Number.isFinite(counted) && counted >= 0 ? counted : null, limit, resetsAt };
  } catch {
    return { answersToday: null, limit, resetsAt };
  }
};
