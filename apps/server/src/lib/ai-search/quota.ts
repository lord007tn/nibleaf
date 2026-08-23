import { Redis } from 'ioredis';
import { env } from '@/env';

let redis: Redis | null = null;

const connection = (): Redis => {
  if (redis) return redis;
  redis = new Redis({
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    db: env.REDIS_DB,
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  redis.on('error', () => undefined);
  return redis;
};

const day = (now: Date): string => now.toISOString().slice(0, 10);

/** Redis-backed project quota. Fail closed when the shared counter is
 * unavailable so a Redis outage cannot turn into unbounded provider spend. */
export const consumeAnswerQuota = async (projectId: string, now = new Date()): Promise<{ allowed: boolean; remaining: number }> => {
  const limit = env.SEARCH_ANSWER_DAILY_PER_PROJECT;
  if (limit === 0) return { allowed: false, remaining: 0 };
  const key = `{search-answer-quota}:${projectId}:${day(now)}`;
  const current = Number(
    await connection().eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],172800) end; return n", 1, key),
  );
  return { allowed: current <= limit, remaining: Math.max(0, limit - current) };
};

export const closeAnswerQuota = async (): Promise<void> => {
  const current = redis;
  redis = null;
  if (current) await current.quit();
};
