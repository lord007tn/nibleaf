import type { JobsOptions } from 'bullmq';
import { QueueNames } from './constants';
import { queues } from './queues/index';
import type { CreateJobOptions, QueueJobMap } from './types';
import { queueLogger } from './utils/logger';
import { sanitizeJobId } from './utils/queue';

/** Create a job in the given queue with full type safety. */
export async function createJob<Q extends QueueNames>(
  queueName: Q,
  payload: { name: QueueJobMap[Q]['name']; data: QueueJobMap[Q]['data'] },
  options: CreateJobOptions = {},
) {
  const queue = queues[queueName];
  const finalOptions: JobsOptions = { ...options };
  if (finalOptions.repeat && !finalOptions.repeat.tz) {
    finalOptions.repeat = { ...finalOptions.repeat, tz: 'UTC' };
  }
  if (finalOptions.jobId) {
    finalOptions.jobId = sanitizeJobId(finalOptions.jobId);
  }
  queueLogger.debug({ queue: queueName, name: payload.name, jobId: finalOptions.jobId }, 'Creating job');
  return await queue.add(payload.name, payload.data, finalOptions);
}

export async function getJob<Q extends QueueNames>(queueName: Q, jobId: string) {
  return await queues[queueName].getJob(sanitizeJobId(jobId));
}

export async function removeJob<Q extends QueueNames>(queueName: Q, jobId: string): Promise<boolean> {
  const job = await queues[queueName].getJob(sanitizeJobId(jobId));
  if (job) {
    await job.remove();
    return true;
  }
  return false;
}

/** Schedule the daily analytics rollup (00:10 UTC). Idempotent — BullMQ upserts by job id. */
export async function scheduleAnalyticsRollup(): Promise<void> {
  await createJob(
    QueueNames.ANALYTICS,
    { name: 'rollup-analytics', data: {} },
    { jobId: 'rollup-analytics-daily', repeat: { pattern: '10 0 * * *', tz: 'UTC' } },
  );
  queueLogger.info('Scheduled daily analytics rollup job');
}

export * from './constants';
export { isQueueEnabled } from './keys';
export {
  closeQueueEvents,
  closeQueues,
  drainAllQueues,
  getAllQueueEvents,
  getQueueEvents,
  pauseAllQueues,
  queues,
  resumeAllQueues,
} from './queues/index';
export * from './types';
export {
  getAllQueueMetrics,
  getQueueMetrics,
  getQueueName,
  QUEUE_CONFIGS,
  type QueueConfigEntry,
  type QueueMetrics,
  sanitizeJobId,
  toBucketedId,
} from './utils/queue';
