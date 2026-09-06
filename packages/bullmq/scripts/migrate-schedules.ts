import { Queue } from 'bullmq';
import { QueueNames } from '../src/constants';
import { producerConnectionConfig } from '../src/redis';
import { migratePlatformSchedules, ScheduleMigrationError } from '../src/schedules';
import { getQueueName, QUEUE_CONFIGS } from '../src/utils/queue';

const args = process.argv.slice(2);
if (args.some((arg) => !['--apply', '--rollback'].includes(arg))) {
  throw new Error('Usage: tsx packages/bullmq/scripts/migrate-schedules.ts [--apply] [--rollback]');
}

const makeQueue = (name: typeof QueueNames.ANALYTICS | typeof QueueNames.EXPORT) =>
  new Queue(getQueueName(name), {
    connection: producerConnectionConfig,
    defaultJobOptions: QUEUE_CONFIGS[name].defaultJobOptions,
    // Even getter-only Queue construction otherwise writes metadata in v5.
    skipMetasUpdate: true,
  });
const queues = { [QueueNames.ANALYTICS]: makeQueue(QueueNames.ANALYTICS), [QueueNames.EXPORT]: makeQueue(QueueNames.EXPORT) };
for (const queue of Object.values(queues)) queue.on('error', () => undefined);

try {
  const result = await migratePlatformSchedules(queues, { apply: args.includes('--apply'), rollback: args.includes('--rollback') });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Connection errors may contain credentials. Keep operator output bounded.
  console.error(
    error instanceof ScheduleMigrationError ? error.message : 'Schedule migration connection failed. Leave queues paused and retry the dry-run.',
  );
  process.exitCode = 1;
} finally {
  await Promise.all(Object.values(queues).map((queue) => queue.close()));
}
