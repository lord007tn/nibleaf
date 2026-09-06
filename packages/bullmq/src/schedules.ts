import { isDeepStrictEqual } from 'node:util';
import type { JobSchedulerJson, JobSchedulerTemplateOptions, Queue } from 'bullmq';
import { QueueNames } from './constants';
import { QUEUE_CONFIGS } from './utils/queue';

class ScheduleConfigurationError extends Error {}

export const PLATFORM_SCHEDULES = [
  { queue: QueueNames.ANALYTICS, id: 'rollup-analytics-daily', name: 'rollup-analytics', pattern: '10 0 * * *' },
  { queue: QueueNames.ANALYTICS, id: 'reconcile-usage-periods', name: 'reconcile-usage', pattern: '*/5 * * * *' },
  { queue: QueueNames.EXPORT, id: 'dispatch-export-schedules', name: 'dispatch-export-schedules', pattern: '* * * * *' },
  { queue: QueueNames.EXPORT, id: 'cleanup-exports', name: 'cleanup-exports', pattern: '17 2 * * *' },
] as const;

type Schedule = (typeof PLATFORM_SCHEDULES)[number];
export type ScheduleQueue = Pick<Queue, 'getJobSchedulers' | 'upsertJobScheduler'>;

const schedulesFor = (queue: Schedule['queue']) => PLATFORM_SCHEDULES.filter((schedule) => schedule.queue === queue);
const repeatOptions = (schedule: Schedule) => ({ pattern: schedule.pattern, tz: 'UTC' });
const jobData = (schedule: Schedule) => (schedule.queue === QueueNames.EXPORT ? { requestedAt: new Date().toISOString() } : {});
const template = (schedule: Schedule) => ({
  name: schedule.name,
  data: jobData(schedule),
  opts: QUEUE_CONFIGS[schedule.queue].defaultJobOptions as JobSchedulerTemplateOptions,
});

function assertDefinition(entry: JobSchedulerJson, schedule: Schedule) {
  if (
    entry.name !== schedule.name ||
    entry.pattern !== schedule.pattern ||
    entry.tz !== 'UTC' ||
    entry.every != null ||
    entry.limit != null ||
    entry.startDate != null ||
    entry.endDate != null ||
    (entry.offset != null && entry.offset !== 0)
  ) {
    throw new ScheduleConfigurationError(`Unexpected schedule configuration in ${schedule.queue}: ${schedule.id}`);
  }
}

function assertData(data: unknown, schedule: Schedule) {
  if (!data || typeof data !== 'object') throw new ScheduleConfigurationError(`Missing schedule data: ${schedule.id}`);
  const fields = Object.keys(data);
  if (schedule.queue === QueueNames.ANALYTICS && fields.length === 0) return;
  if (
    schedule.queue === QueueNames.EXPORT &&
    fields.length === 1 &&
    fields[0] === 'requestedAt' &&
    'requestedAt' in data &&
    typeof data.requestedAt === 'string' &&
    Number.isFinite(Date.parse(data.requestedAt))
  ) {
    return;
  }
  throw new ScheduleConfigurationError(`Unexpected schedule data: ${schedule.id}`);
}

function assertTemplate(entry: JobSchedulerJson, schedule: Schedule) {
  assertData(entry.template?.data ?? {}, schedule);
  const opts = entry.template?.opts ?? {};
  const expected = QUEUE_CONFIGS[schedule.queue].defaultJobOptions;
  if (!isDeepStrictEqual(opts, expected)) throw new ScheduleConfigurationError(`Unexpected schedule job options: ${schedule.id}`);
}

/** Refuse unknown or unmigrated definitions before any scheduler is updated. */
async function inspectPlatformSchedules(queue: ScheduleQueue, queueName: Schedule['queue']) {
  const entries = await queue.getJobSchedulers(0, -1, true);
  const definitions = schedulesFor(queueName);
  for (const entry of entries) {
    const schedule = definitions.find((candidate) => entry.key === candidate.id);
    if (!schedule) {
      throw new ScheduleConfigurationError(
        `Unknown recurring configuration in ${queueName}; complete the migration using the retained staged v5 image`,
      );
    }
    assertDefinition(entry, schedule);
    assertTemplate(entry, schedule);
  }
  return definitions;
}

/** Fresh queues create schedulers; migrated queues retain the same stable IDs. */
export async function ensurePlatformSchedules(queue: ScheduleQueue, queueName: Schedule['queue']) {
  const definitions = await inspectPlatformSchedules(queue, queueName);
  for (const schedule of definitions) await queue.upsertJobScheduler(schedule.id, repeatOptions(schedule), template(schedule));
}
