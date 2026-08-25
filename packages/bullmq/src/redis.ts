import type { RedisOptions } from 'ioredis';
import { keys } from './keys';

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
  // Keep the v5 RESP2 wire contract for Dragonfly and self-hosted Redis.
  // ioredis 6 defaults to RESP3; switching protocol is a separate migration.
  protocol: 2,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: null,
};

/**
 * Producer (Queue) connections must FAIL FAST rather than buffer.
 *
 * ioredis's offline queue silently holds commands while redis is unreachable, so
 * `queue.add()` returns a promise that never settles instead of rejecting. On a
 * request path (sign-up's starter publish, per-pageview analytics) that turns a
 * redis outage into a hung HTTP request — and a command that later flushes on
 * reconnect, double-writing work the caller already fell back on.
 *
 * Workers keep the offline queue: their blocking commands MUST survive a
 * reconnect or they stop picking up jobs.
 */
export const producerConnectionConfig: RedisOptions = {
  ...redisConnectionConfig,
  enableOfflineQueue: false,
};
