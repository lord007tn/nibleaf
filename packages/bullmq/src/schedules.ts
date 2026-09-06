import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { JobSchedulerJson, JobSchedulerTemplateOptions, Queue } from 'bullmq';
import { QueueNames } from './constants';
import { QUEUE_CONFIGS } from './utils/queue';

export class ScheduleMigrationError extends Error {}

export const PLATFORM_SCHEDULES = [
  { queue: QueueNames.ANALYTICS, id: 'rollup-analytics-daily', name: 'rollup-analytics', pattern: '10 0 * * *' },
  { queue: QueueNames.ANALYTICS, id: 'reconcile-usage-periods', name: 'reconcile-usage', pattern: '*/5 * * * *' },
  { queue: QueueNames.EXPORT, id: 'dispatch-export-schedules', name: 'dispatch-export-schedules', pattern: '* * * * *' },
  { queue: QueueNames.EXPORT, id: 'cleanup-exports', name: 'cleanup-exports', pattern: '17 2 * * *' },
] as const;

type Schedule = (typeof PLATFORM_SCHEDULES)[number];
export type ScheduleQueue = Pick<
  Queue,
  | 'getRepeatableJobs'
  | 'getJobSchedulers'
  | 'upsertJobScheduler'
  | 'removeRepeatableByKey'
  | 'removeJobScheduler'
  | 'add'
  | 'isPaused'
  | 'getActiveCount'
  | 'getWaitingCount'
  | 'getJob'
>;
export type ScheduleQueues = Record<Schedule['queue'], ScheduleQueue>;

/** BullMQ v5's default repeat hash; no application queue overrides that setting. */
export const legacyScheduleKey = (schedule: Schedule) =>
  createHash('md5').update(`${schedule.name}:${schedule.id}::UTC:${schedule.pattern}`).digest('hex');

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
    throw new ScheduleMigrationError(`Unexpected schedule configuration in ${schedule.queue}: ${schedule.id}`);
  }
}

function assertData(data: unknown, schedule: Schedule) {
  if (!data || typeof data !== 'object') throw new ScheduleMigrationError(`Missing schedule data: ${schedule.id}`);
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
  throw new ScheduleMigrationError(`Unexpected schedule data: ${schedule.id}`);
}

function assertTemplate(entry: JobSchedulerJson, schedule: Schedule) {
  assertData(entry.template?.data ?? {}, schedule);
  const opts = entry.template?.opts ?? {};
  const expected = QUEUE_CONFIGS[schedule.queue].defaultJobOptions;
  if (!isDeepStrictEqual(opts, expected)) throw new ScheduleMigrationError(`Unexpected schedule job options: ${schedule.id}`);
}

/** Both v5 getter APIs expose the shared repeat set. Only known keys qualify. */
export async function inspectPlatformSchedules(queue: ScheduleQueue, queueName: Schedule['queue']) {
  const entries = await queue.getJobSchedulers(0, -1, true);
  const legacy = await queue.getRepeatableJobs(0, -1, true);
  const definitions = schedulesFor(queueName);
  const result: Array<{ schedule: Schedule; legacyKey?: string; scheduler: boolean; next?: number }> = definitions.map((schedule) => ({
    schedule,
    scheduler: false,
  }));
  for (const entry of entries) {
    const match = result.find(({ schedule }) => entry.key === schedule.id || entry.key === legacyScheduleKey(schedule));
    if (!match) throw new ScheduleMigrationError(`Unknown recurring configuration in ${queueName}; no changes made`);
    assertDefinition(entry, match.schedule);
    if (entry.key === match.schedule.id) {
      assertTemplate(entry, match.schedule);
      match.scheduler = true;
    } else {
      match.legacyKey = entry.key;
      match.next = entry.next;
    }
  }
  // Refuse an inconsistent inventory rather than treating an unread entry as absent.
  if (legacy.length !== entries.length || legacy.some((entry) => !entries.some((scheduler) => scheduler.key === entry.key))) {
    throw new ScheduleMigrationError(`Recurring inventory changed in ${queueName}; retry while workers are stopped`);
  }
  return result;
}

/** Existing installations keep legacy schedules until an explicit operator migration.
 * Fresh queues use schedulers. Startup never recreates a legacy definition. */
export async function ensurePlatformSchedules(queue: ScheduleQueue, queueName: Schedule['queue']) {
  const inventory = await inspectPlatformSchedules(queue, queueName);
  if (inventory.some((entry) => entry.legacyKey) && inventory.some((entry) => entry.scheduler)) {
    throw new ScheduleMigrationError(`Mixed legacy and scheduler state in ${queueName}; leave queues paused and finish migration`);
  }
  if (inventory.some((entry) => entry.legacyKey)) return;
  for (const { schedule } of inventory) await queue.upsertJobScheduler(schedule.id, repeatOptions(schedule), template(schedule));
}

async function assertQuiescent(queue: ScheduleQueue) {
  if (!(await queue.isPaused()) || (await queue.getActiveCount()) !== 0 || (await queue.getWaitingCount()) !== 0) {
    throw new ScheduleMigrationError('Migration requires affected queues paused, no active/waiting jobs, and all scheduling processes stopped');
  }
}

async function assertLegacyJob(queue: ScheduleQueue, entry: Awaited<ReturnType<typeof inspectPlatformSchedules>>[number]) {
  if (!entry.legacyKey) return;
  const job = await queue.getJob(`repeat:${entry.legacyKey}:${entry.next}`);
  if (!job || job.name !== entry.schedule.name) throw new ScheduleMigrationError(`Missing legacy occurrence: ${entry.schedule.id}`);
  assertData(job.data, entry.schedule);
  const expectedOptions = QUEUE_CONFIGS[entry.schedule.queue].defaultJobOptions;
  const dynamicOptions = ['repeat', 'jobId', 'delay', 'timestamp', 'prevMillis', 'repeatJobKey'];
  if (
    Object.entries(expectedOptions).some(([key, value]) => !isDeepStrictEqual(job.opts[key as keyof typeof job.opts], value)) ||
    Object.keys(job.opts).some((key) => !(key in expectedOptions) && !dynamicOptions.includes(key))
  ) {
    throw new ScheduleMigrationError(`Unexpected legacy job options: ${entry.schedule.id}`);
  }
  const repeat = job.opts.repeat;
  if (
    !repeat ||
    repeat.pattern !== entry.schedule.pattern ||
    repeat.tz !== 'UTC' ||
    repeat.jobId !== entry.schedule.id ||
    Object.keys(repeat).some((key) => !['pattern', 'tz', 'jobId', 'count', 'offset'].includes(key)) ||
    (repeat.offset != null && repeat.offset !== 0)
  ) {
    throw new ScheduleMigrationError(`Unexpected legacy occurrence options: ${entry.schedule.id}`);
  }
}

/** Read-only by default. The caller owns stopping processes and pausing/resuming queues.
 * No broad drain, obliterate, or arbitrary job removal is performed. */
export async function migratePlatformSchedules(queues: ScheduleQueues, options: { apply?: boolean; rollback?: boolean } = {}) {
  const names = [QueueNames.ANALYTICS, QueueNames.EXPORT] as const;
  const states = await Promise.all(
    names.map(async (name) => ({ name, queue: queues[name], inventory: await inspectPlatformSchedules(queues[name], name) })),
  );
  for (const state of states) {
    for (const entry of state.inventory) await assertLegacyJob(state.queue, entry);
  }
  const summary = () =>
    states.flatMap(({ inventory }) =>
      inventory.map(({ schedule, legacyKey, scheduler }) => ({
        queue: schedule.queue,
        id: schedule.id,
        legacy: Boolean(legacyKey),
        scheduler,
      })),
    );
  if (!options.apply) return { applied: false, rollback: Boolean(options.rollback), schedules: summary() };
  for (const name of names) await assertQuiescent(queues[name]);

  // Create and verify EVERY destination before removing ANY source definition.
  for (const schedule of PLATFORM_SCHEDULES) {
    const queue = queues[schedule.queue];
    if (options.rollback) {
      await queue.add(schedule.name, jobData(schedule), { jobId: schedule.id, repeat: repeatOptions(schedule) });
    } else {
      await queue.upsertJobScheduler(schedule.id, repeatOptions(schedule), template(schedule));
    }
  }
  for (const name of names) {
    const verified = await inspectPlatformSchedules(queues[name], name);
    for (const entry of verified) {
      if (options.rollback ? !entry.legacyKey : !entry.scheduler)
        throw new ScheduleMigrationError(`Destination verification failed: ${entry.schedule.id}`);
      if (options.rollback) await assertLegacyJob(queues[name], entry);
    }
    await assertQuiescent(queues[name]);
  }
  for (const { inventory } of states) {
    for (const entry of inventory) {
      const queue = queues[entry.schedule.queue];
      if (options.rollback && entry.scheduler) await queue.removeJobScheduler(entry.schedule.id);
      if (!options.rollback && entry.legacyKey) await queue.removeRepeatableByKey(entry.legacyKey);
    }
  }
  for (const state of states) {
    state.inventory = await inspectPlatformSchedules(state.queue, state.name);
    if (state.inventory.some((entry) => (options.rollback ? entry.scheduler || !entry.legacyKey : entry.legacyKey || !entry.scheduler))) {
      throw new ScheduleMigrationError(`Migration incomplete in ${state.name}; leave queues paused and retry`);
    }
  }
  return { applied: true, rollback: Boolean(options.rollback), schedules: summary() };
}
