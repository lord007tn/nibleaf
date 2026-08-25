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

export const queues: Record<QueueNames, Queue> = {
  [QueueNames.PUBLISH]: makeQueue(QueueNames.PUBLISH),
  [QueueNames.SEARCH]: makeQueue(QueueNames.SEARCH),
  [QueueNames.EMAIL]: makeQueue(QueueNames.EMAIL),
  [QueueNames.ANALYTICS]: makeQueue(QueueNames.ANALYTICS),
  [QueueNames.EXPORT]: makeQueue(QueueNames.EXPORT),
  [QueueNames.GIT]: makeQueue(QueueNames.GIT),
};

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
  await Promise.all(Object.values(queues).map((q) => q.pause()));
}
export async function resumeAllQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.resume()));
}
export async function drainAllQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.drain()));
}
export async function closeQueues(): Promise<void> {
  await Promise.all(Object.values(queues).map((q) => q.close()));
}
export async function closeQueueEvents(): Promise<void> {
  await Promise.all(Object.values(queueEventsCache).map((e) => e?.close()));
  queueLogger.debug('Closed queue events');
}
