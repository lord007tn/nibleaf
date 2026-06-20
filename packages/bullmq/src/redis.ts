import { Redis, type RedisOptions } from 'ioredis';
import { keys } from './keys';
import { queueLogger } from './utils/logger';

const env = keys();

/**
 * Shared connection options for every BullMQ Queue / Worker / QueueEvents.
 * `maxRetriesPerRequest: null` is REQUIRED by BullMQ — blocking commands must
 * never give up, otherwise the worker silently stops picking up jobs.
 */
export const redisConnectionConfig: RedisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  db: env.REDIS_DB,
  ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null,
};

export function createRedisConnection(): Redis {
  return new Redis(redisConnectionConfig);
}

export const redis = createRedisConnection();

redis.on('connect', () => queueLogger.info('Connected to Redis'));
redis.on('error', (err) => queueLogger.error({ err }, 'Redis error'));

export { redis as default };
