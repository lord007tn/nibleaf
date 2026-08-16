import type { JobsOptions, Queue } from 'bullmq';
import { QueueNames } from '../constants';
import { keys } from '../keys';
import { queueLogger } from './logger';

const env = keys();

const ONE_HOUR = 60 * 60;
const ONE_DAY = ONE_HOUR * 24;
const ONE_WEEK = ONE_DAY * 7;
const MINUTE_MS = 60 * 1000;

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  removeOnComplete: { count: 100, age: ONE_DAY },
  removeOnFail: { count: 500, age: ONE_WEEK },
  attempts: 3,
  backoff: { type: 'exponential', delay: 1000 },
};

export interface QueueConfigEntry {
  concurrency: number;
  defaultJobOptions: JobsOptions;
  limiter?: { duration: number; max: number };
  /** Worker lock TTL. Long-running jobs must exceed their worst-case runtime. */
  lockDuration?: number;
  maxStalledCount: number;
  stalledInterval: number;
}

export const QUEUE_CONFIGS: Record<QueueNames, QueueConfigEntry> = {
  [QueueNames.PUBLISH]: {
    concurrency: env.PUBLISH_CONCURRENCY,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 2, backoff: { type: 'exponential', delay: 3000 } },
    lockDuration: 10 * MINUTE_MS,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  },
  [QueueNames.SEARCH]: {
    concurrency: env.SEARCH_CONCURRENCY,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 3 },
    lockDuration: 5 * MINUTE_MS,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
  [QueueNames.EMAIL]: {
    concurrency: env.EMAIL_CONCURRENCY,
    defaultJobOptions: { ...DEFAULT_JOB_OPTIONS, attempts: 3 },
    limiter: { max: 10, duration: 1000 },
    stalledInterval: 30_000,
    maxStalledCount: 1,
  },
  [QueueNames.ANALYTICS]: {
    concurrency: env.ANALYTICS_CONCURRENCY,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 2,
      backoff: { type: 'exponential', delay: 500 },
      removeOnComplete: { count: 50, age: ONE_HOUR },
    },
    limiter: { max: 100, duration: 1000 },
    stalledInterval: 15_000,
    maxStalledCount: 1,
  },
  [QueueNames.EXPORT]: {
    concurrency: env.EXPORT_CONCURRENCY,
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { count: 200, age: ONE_DAY },
    },
    // Static bundles and Chromium PDF rendering can be large, but must still
    // renew their BullMQ lock well beyond ordinary request timeouts.
    lockDuration: 30 * MINUTE_MS,
    stalledInterval: 60_000,
    maxStalledCount: 1,
  },
};

/** Wrap queue names in a Redis hash tag so BullMQ keys stay grouped for Dragonfly. */
export function getQueueName(name: string): string {
  return env.QUEUE_CLUSTER ? `{${name}}` : name;
}

/** Sanitize custom job IDs (BullMQ rejects ':'). */
export function sanitizeJobId(id: string): string {
  return id.replace(/[^a-zA-Z0-9\-_]/g, '-');
}

/** Bucket a key into a fixed window to dedupe rapid duplicate submissions. */
export function toBucketedId(prefix: string, key: string, windowMs = 30_000): string {
  const bucket = Math.floor(Date.now() / windowMs);
  return sanitizeJobId(`${prefix}-${key}-${bucket}`);
}

export interface QueueMetrics {
  active: number;
  completed: number;
  delayed: number;
  failed: number;
  name: string;
  paused: number;
  waiting: number;
}

export async function getQueueMetrics(queue: Queue): Promise<QueueMetrics> {
  const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
    queue.isPaused(),
  ]);
  return { name: queue.name, waiting, active, completed, failed, delayed, paused: paused ? 1 : 0 };
}

export function getAllQueueMetrics(queueMap: Record<string, Queue>): Promise<QueueMetrics[]> {
  return Promise.all(Object.values(queueMap).map(getQueueMetrics));
}

export { queueLogger };
