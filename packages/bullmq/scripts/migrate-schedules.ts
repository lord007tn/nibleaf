import { QueueNames } from '../src/constants';
import { closeQueues, getQueue } from '../src/queues/index';
import { migratePlatformSchedules, ScheduleMigrationError } from '../src/schedules';

const args = process.argv.slice(2);
if (args.some((arg) => !['--apply', '--rollback'].includes(arg))) {
  throw new Error('Usage: tsx packages/bullmq/scripts/migrate-schedules.ts [--apply] [--rollback]');
}

try {
  const queues = { [QueueNames.ANALYTICS]: getQueue(QueueNames.ANALYTICS), [QueueNames.EXPORT]: getQueue(QueueNames.EXPORT) };
  for (const queue of Object.values(queues)) queue.on('error', () => undefined);
  const result = await migratePlatformSchedules(queues, { apply: args.includes('--apply'), rollback: args.includes('--rollback') });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  // Connection errors may contain credentials. Keep operator output bounded.
  console.error(
    error instanceof ScheduleMigrationError ? error.message : 'Schedule migration connection failed. Leave queues paused and retry the dry-run.',
  );
  process.exitCode = 1;
} finally {
  await closeQueues();
}
