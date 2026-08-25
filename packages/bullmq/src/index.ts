import type { JobsOptions, RepeatOptions } from 'bullmq';
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
  if (finalOptions.jobId) {
    finalOptions.jobId = sanitizeJobId(finalOptions.jobId);
  }
  queueLogger.debug({ queue: queueName, name: payload.name, jobId: finalOptions.jobId }, 'Creating job');
  return await queue.add(payload.name, payload.data, finalOptions);
}

async function upsertScheduledJob<Q extends QueueNames>(
  queueName: Q,
  schedulerId: string,
  schedule: Omit<RepeatOptions, 'key'>,
  payload: { name: QueueJobMap[Q]['name']; data: QueueJobMap[Q]['data'] },
): Promise<void> {
  const queue = queues[queueName];
  await queue.upsertJobScheduler(schedulerId, schedule.tz ? schedule : { ...schedule, tz: 'UTC' }, { name: payload.name, data: payload.data });
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
  await upsertScheduledJob(
    QueueNames.ANALYTICS,
    'rollup-analytics-daily',
    { pattern: '10 0 * * *', tz: 'UTC' },
    { name: 'rollup-analytics', data: {} },
  );
  await upsertScheduledJob(
    QueueNames.ANALYTICS,
    'reconcile-usage-periods',
    { pattern: '*/5 * * * *', tz: 'UTC' },
    { name: 'reconcile-usage', data: {} },
  );
  queueLogger.info('Scheduled daily analytics rollup job');
}

/** Poll due database-backed archive schedules once a minute. The fixed job id
 * makes startup idempotent across any number of worker replicas. */
export async function scheduleExportMaintenance(): Promise<void> {
  await upsertScheduledJob(
    QueueNames.EXPORT,
    'dispatch-export-schedules',
    { pattern: '* * * * *', tz: 'UTC' },
    { name: 'dispatch-export-schedules', data: { requestedAt: new Date().toISOString() } },
  );
  await upsertScheduledJob(
    QueueNames.EXPORT,
    'cleanup-exports',
    { pattern: '17 2 * * *', tz: 'UTC' },
    { name: 'cleanup-exports', data: { requestedAt: new Date().toISOString() } },
  );
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
