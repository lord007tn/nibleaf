import { keys as bullmqKeys } from '@nibleaf/bullmq/keys';
import { Redis } from 'ioredis';
import { AppError } from '@/errors';
import { envExtras } from './env-extras';

/**
 * Per-workspace daily quota for the AI draft endpoint — the only place the
 * platform spends money per request, so it must be bounded. Backed by a redis
 * INCR with a 24h TTL (same Dragonfly instance BullMQ uses).
 */

let client: Redis | null = null;

const getRedis = (): Redis => {
  if (!client) {
    const redisEnv = bullmqKeys();
    client = new Redis({
      host: redisEnv.REDIS_HOST,
      port: redisEnv.REDIS_PORT,
      db: redisEnv.REDIS_DB,
      ...(redisEnv.REDIS_PASSWORD ? { password: redisEnv.REDIS_PASSWORD } : {}),
      protocol: 2,
      // Quota checks must fail fast, not queue up while redis is down.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: (times) => Math.min(times * 100, 2000),
    });
    // Command failures are handled by the quota check below.
    client.on('error', () => undefined);
  }
  return client;
};

const DAY_SECONDS = 24 * 60 * 60;

/**
 * Count one AI request against the workspace's daily budget and throw a 429
 * once it is exhausted. Drafting requires an available quota counter.
 */
export const assertAiQuota = async (organizationId: string): Promise<void> => {
  const limit = envExtras.AI_DAILY_LIMIT;
  const day = new Date().toISOString().slice(0, 10);
  const key = `nibleaf:ai-quota:${organizationId}:${day}`;

  let used: number;
  try {
    const redis = getRedis();
    const results = await redis.multi().incr(key).expire(key, DAY_SECONDS, 'NX').exec();
    if (results?.length !== 2) throw new Error('Quota transaction did not complete');
    for (const [error] of results) if (error) throw error;
    const count = results[0]?.[1];
    if (typeof count !== 'number') throw new Error('Quota transaction returned an invalid count');
    used = count;
  } catch (cause) {
    throw new AppError({ code: 'usage:unavailable', message: 'AI drafting is temporarily unavailable. Try again in a few minutes.', cause });
  }

  if (used > limit) {
    throw new AppError({
      code: 'http:rate_limited',
      message: `This workspace has reached its daily AI limit of ${limit} requests. The counter resets within 24 hours.`,
      details: { limit, scope: 'workspace', period: 'day' },
    });
  }
};

/** Read today's counter without consuming a drafting request. Read failures are
 * unavailable, never a false claim that there is budget. */
export const isAiQuotaExhausted = async (organizationId: string): Promise<boolean> => {
  if (envExtras.AI_DAILY_LIMIT === 0) return true;
  const day = new Date().toISOString().slice(0, 10);
  try {
    const used = Number(await getRedis().get(`nibleaf:ai-quota:${organizationId}:${day}`));
    if (!Number.isSafeInteger(used) || used < 0) throw new Error('Invalid quota counter.');
    return used >= envExtras.AI_DAILY_LIMIT;
  } catch {
    throw new AppError({ code: 'usage:unavailable' });
  }
};
