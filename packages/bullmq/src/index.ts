import type { JobsOptions } from 'bullmq';
import { QueueNames } from './constants';
import { getQueue } from './queues/index';
import { ensurePlatformSchedules } from './schedules';
import type { CreateJobOptions, QueueJobMap } from './types';
import { queueLogger } from './utils/logger';
import { sanitizeJobId } from './utils/queue';

/** Create a job in the given queue with full type safety. */
export async function createJob<Q extends QueueNames>(
  queueName: Q,
  payload: { name: QueueJobMap[Q]['name']; data: QueueJobMap[Q]['data'] },
  options: CreateJobOptions = {},
) {
  const queue = getQueue(queueName);
  const finalOptions: JobsOptions = { ...options };
  if (finalOptions.jobId) {
    finalOptions.jobId = sanitizeJobId(finalOptions.jobId);
  }
  queueLogger.debug({ queue: queueName, name: payload.name, jobId: finalOptions.jobId }, 'Creating job');
  return await queue.add(payload.name, payload.data, finalOptions);
}

export async function getJob<Q extends QueueNames>(queueName: Q, jobId: string) {
  return await getQueue(queueName).getJob(sanitizeJobId(jobId));
}

export async function removeJob<Q extends QueueNames>(queueName: Q, jobId: string): Promise<boolean> {
  const job = await getQueue(queueName).getJob(sanitizeJobId(jobId));
  if (job) {
    await job.remove();
    return true;
  }
  return false;
}

/** Maintain the verified scheduler definitions after the staged v5 migration. */
export async function scheduleAnalyticsRollup(): Promise<void> {
  await ensurePlatformSchedules(getQueue(QueueNames.ANALYTICS), QueueNames.ANALYTICS);
  queueLogger.info('Scheduled daily analytics rollup job');
}

/** Stable scheduler IDs make startup idempotent after the explicit v5 migration. */
export async function scheduleExportMaintenance(): Promise<void> {
  await ensurePlatformSchedules(getQueue(QueueNames.EXPORT), QueueNames.EXPORT);
}

export * from './constants';
export { isQueueEnabled } from './keys';
export {
  closeQueueEvents,
  closeQueues,
  drainAllQueues,
  getAllQueueEvents,
  getQueue,
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
