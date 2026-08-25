import { Queue, QueueEvents } from 'bullmq';
import { QueueNames } from '../constants';
import { isQueueEnabled } from '../keys';
import { producerConnectionConfig, redisConnectionConfig } from '../redis';
import type { QueueJobMap } from '../types';
import { queueLogger } from '../utils/logger';
import { getQueueName, QUEUE_CONFIGS } from '../utils/queue';

function makeQueue<Q extends QueueNames>(name: Q): Queue<QueueJobMap[Q]['data'], unknown, QueueJobMap[Q]['name']> {
  return new Queue<QueueJobMap[Q]['data'], unknown, QueueJobMap[Q]['name']>(getQueueName(name), {
    // Fail fast: an unreachable redis must reject `add()` (so callers can fall
    // back), never buffer the command into a promise that hangs the request.
    connection: producerConnectionConfig,
    defaultJobOptions: QUEUE_CONFIGS[name].defaultJobOptions,
  });
}

const queueCache: Partial<Record<QueueNames, Queue<unknown, unknown, string>>> = {};

/**
 * Return an owned producer queue, creating its Redis connection on first use.
 *
 * Importing `@nibleaf/bullmq` must be side-effect free. Eager construction used
 * to open six Redis clients merely because an action module imported
 * `createJob`; unit tests that never queued work then leaked reconnect attempts
 * beyond Vitest environment teardown. Lazy ownership also gives each process a
 * finite set of clients that `closeQueues()` can deterministically release.
 */
export function getQueue(name: QueueNames): Queue<unknown, unknown, string> {
  const existing = queueCache[name];
  if (existing) {
    return existing;
  }
  const queue = makeQueue(name) as Queue<unknown, unknown, string>;
  queueCache[name] = queue;
  return queue;
}

/** Backwards-compatible lazy registry for dashboards and worker maintenance. */
export const queues = {} as Record<QueueNames, Queue<unknown, unknown, string>>;
for (const name of Object.values(QueueNames)) {
  Object.defineProperty(queues, name, {
    configurable: false,
    enumerable: true,
    get: () => getQueue(name),
  });
}

const allQueues = () => Object.values(QueueNames).map((name) => getQueue(name));

const queueEventsCache: Partial<Record<QueueNames, QueueEvents>> = {};

export function getQueueEvents(queueName: QueueNames): QueueEvents | null {
  if (!isQueueEnabled(queueName)) {
    return null;
  }
  if (!queueEventsCache[queueName]) {
    queueEventsCache[queueName] = new QueueEvents(getQueueName(queueName), { connection: redisConnectionConfig });
  }
  return queueEventsCache[queueName] ?? null;
}

export function getAllQueueEvents(): Partial<Record<QueueNames, QueueEvents>> {
  const result: Partial<Record<QueueNames, QueueEvents>> = {};
  for (const name of Object.values(QueueNames)) {
    const events = getQueueEvents(name);
    if (events) {
      result[name] = events;
    }
  }
  return result;
}

export async function pauseAllQueues(): Promise<void> {
  await Promise.all(allQueues().map((q) => q.pause()));
}
export async function resumeAllQueues(): Promise<void> {
  await Promise.all(allQueues().map((q) => q.resume()));
}
export async function drainAllQueues(): Promise<void> {
  await Promise.all(allQueues().map((q) => q.drain()));
}
export async function closeQueues(): Promise<void> {
  const ownedQueues = Object.values(queueCache);
  for (const name of Object.values(QueueNames)) {
    delete queueCache[name];
  }
  await Promise.all(ownedQueues.map((q) => q.close()));
  queueLogger.debug({ count: ownedQueues.length }, 'Closed producer queues');
}
export async function closeQueueEvents(): Promise<void> {
  await Promise.all(Object.values(queueEventsCache).map((e) => e?.close()));
  queueLogger.debug('Closed queue events');
}
