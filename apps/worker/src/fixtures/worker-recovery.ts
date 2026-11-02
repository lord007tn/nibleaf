// Disposable integration-test process. Never started by the production entrypoint.
import { closeQueueEvents, closeQueues, QueueNames } from '@nibleaf/bullmq';
import { bootWorkers, closeWorkers, getWorkerHealth } from '@nibleaf/bullmq/workers';
import { createWorkerAlertSender } from '../lib/worker-alerts';
import { handleEmailJobs } from '../processors/email';
import { createWorkerShutdown } from '../shutdown';
import { startWorkerMonitor } from '../worker-monitor';

if (process.env.QUEUE_INTEGRATION !== '1' || !process.send) throw new Error('Recovery fixture requires explicit integration opt-in and IPC.');
const workers = await bootWorkers({ [QueueNames.EMAIL]: handleEmailJobs });
await Promise.all(workers.map((worker) => worker.waitUntilReady()));
let stopMonitor: (() => void) | undefined;
const shutdown = createWorkerShutdown({
  cleanup: async () => {
    await Promise.all([closeWorkers(), closeQueueEvents(), closeQueues()]);
  },
  unready: () => stopMonitor?.(),
  timeoutMs: 500,
});
stopMonitor = startWorkerMonitor({
  alert: createWorkerAlertSender({ stateFile: process.env.NIBLEAF_RECOVERY_TEST_STATE }),
  restart: () => void shutdown('queue-unavailable', 1),
  intervalMs: 50,
  recoveryAfterMs: 1000,
});
process.on('message', (command) => {
  void (async () => {
    if (command === 'shutdown') await shutdown('SIGTERM');
  })().catch(() => process.exit(1));
});
process.send({ event: 'ready', health: await getWorkerHealth() });
