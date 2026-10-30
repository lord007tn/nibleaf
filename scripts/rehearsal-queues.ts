import { Queue } from 'bullmq';
import { producerConnectionConfig } from '../src/redis';
import { getQueueName } from '../src/utils/queue';
const mode = process.argv[2];
const queues = ['analytics', 'export'].map(name => new Queue(getQueueName(name), { connection: producerConnectionConfig, skipMetasUpdate: true }));
try {
  for (const queue of queues) {
    if (mode === 'pause') await queue.pause();
    if (mode === 'resume') await queue.resume();
    if (mode === 'pause') {
      for (let attempt = 0; attempt < 60 && await queue.getActiveCount(); attempt++) await new Promise(resolve => setTimeout(resolve, 1000));
      if (await queue.getActiveCount() || await queue.getWaitingCount()) throw new Error('Queue is not quiescent; do not drain user jobs.');
    }
    if (mode === 'legacy') {
      const definitions = await queue.getRepeatableJobs();
      if (definitions.length !== 2) throw new Error('Expected two legacy definitions per queue.');
    }
    if (mode === 'inventory') {
      const definitions = await queue.getJobSchedulers(0, -1, true);
      const expected = queue.name.includes('analytics') ? ['rollup-analytics-daily', 'reconcile-usage-periods'] : ['dispatch-export-schedules', 'cleanup-exports'];
      if (definitions.length !== 2 || definitions.some(entry => !expected.includes(entry.key))) throw new Error('Unexpected candidate scheduler inventory.');
    }
  }
  console.log(`queues ${mode}: PASS`);
} catch { console.error(`queues ${mode}: FAIL`); process.exitCode = 1; }
finally { await Promise.all(queues.map(queue => queue.close())); }
