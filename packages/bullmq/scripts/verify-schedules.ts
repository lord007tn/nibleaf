import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { QueueNames } from '../src/constants';
import { ensurePlatformSchedules, migratePlatformSchedules, PLATFORM_SCHEDULES } from '../src/schedules';
import { QUEUE_CONFIGS } from '../src/utils/queue';

// Requires an explicit disposable Redis/Dragonfly endpoint. Never flush a DB.
const endpoint = process.env.SCHEDULE_TEST_REDIS_URL;
if (!endpoint) throw new Error('Set SCHEDULE_TEST_REDIS_URL to a disposable test Redis/Dragonfly endpoint');
const url = new URL(endpoint);
if (url.protocol !== 'redis:') throw new Error('This disposable integration runner expects redis://');
const connection = {
  host: url.hostname,
  port: Number(url.port || 6379),
  username: url.username ? decodeURIComponent(url.username) : undefined,
  password: url.password ? decodeURIComponent(url.password) : undefined,
  db: Number(url.pathname.slice(1) || 0),
  maxRetriesPerRequest: 1,
  retryStrategy: () => null,
};
const prefix = `nibleaf-schedule-test-${randomUUID()}`;
const queues = {
  analytics: new Queue(`{${prefix}-analytics}`, { connection, defaultJobOptions: QUEUE_CONFIGS.analytics.defaultJobOptions }),
  export: new Queue(`{${prefix}-export}`, { connection, defaultJobOptions: QUEUE_CONFIGS.export.defaultJobOptions }),
};
for (const queue of Object.values(queues)) {
  // Promise rejection below reports transport failure and still reaches cleanup.
  queue.on('error', () => undefined);
}

try {
  await Promise.all(Object.values(queues).map((queue) => queue.pause()));
  for (const schedule of PLATFORM_SCHEDULES) {
    await queues[schedule.queue].add(schedule.name, schedule.queue === QueueNames.EXPORT ? { requestedAt: new Date().toISOString() } : {}, {
      jobId: schedule.id,
      repeat: { pattern: schedule.pattern, tz: 'UTC' },
    });
  }
  const before = await migratePlatformSchedules(queues);
  assert.equal(before.applied, false);
  assert.ok(before.schedules.every((entry) => entry.legacy && !entry.scheduler));
  await ensurePlatformSchedules(queues.analytics, QueueNames.ANALYTICS);
  assert.deepEqual((await migratePlatformSchedules(queues)).schedules, before.schedules);
  const migrated = await migratePlatformSchedules(queues, { apply: true });
  assert.ok(migrated.schedules.every((entry) => !entry.legacy && entry.scheduler));
  assert.deepEqual((await migratePlatformSchedules(queues, { apply: true })).schedules, migrated.schedules);
  await ensurePlatformSchedules(queues.analytics, QueueNames.ANALYTICS);
  await ensurePlatformSchedules(queues.export, QueueNames.EXPORT);
  assert.deepEqual((await migratePlatformSchedules(queues)).schedules, migrated.schedules);
  const rolledBack = await migratePlatformSchedules(queues, { apply: true, rollback: true });
  assert.deepEqual(rolledBack.schedules, before.schedules);
  assert.deepEqual((await migratePlatformSchedules(queues, { apply: true, rollback: true })).schedules, before.schedules);
  const final = await migratePlatformSchedules(queues, { apply: true });
  assert.deepEqual(final.schedules, migrated.schedules);
} finally {
  // The only deletion is of UUID-owned test queues created by this process.
  const cleanup = await Promise.allSettled(
    Object.values(queues).map(async (queue) => {
      try {
        await queue.obliterate({ force: true });
      } finally {
        await queue.close();
      }
    }),
  );
  if (cleanup.some((result) => result.status === 'rejected')) {
    console.error('Isolated queue cleanup could not complete; remove the disposable test server');
    process.exitCode = 1;
  }
}
if (!process.exitCode)
  console.log('PASS: real legacy dry-run, startup preservation, migration, retry, scheduler startup, rollback, rollback retry, remigration');
