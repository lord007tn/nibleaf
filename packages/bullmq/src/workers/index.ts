import { type Job, Worker, type WorkerOptions } from 'bullmq';
import { QueueNames } from '../constants';
import { isQueueEnabled, keys } from '../keys';
import { closeQueueEvents as _closeQueueEvents, closeQueues as _closeQueues, queues } from '../queues/index';
import { redisConnectionConfig } from '../redis';
import type { ProcessorRegistry } from '../types';
import { queueLogger } from '../utils/logger';
import { getQueueName, QUEUE_CONFIGS } from '../utils/queue';
import { inspectWorkerConnection, type WorkerConnectionHealth } from './readiness';

export type { ProcessorRegistry } from '../types';

interface WorkerEntry {
  name: QueueNames;
  worker: Worker;
}

const activeWorkers: WorkerEntry[] = [];

export type QueueWorkerHealth = WorkerConnectionHealth & { queue: QueueNames };

export const getWorkerHealth = (): Promise<QueueWorkerHealth[]> =>
  Promise.all(
    activeWorkers.map(async ({ name, worker }) => ({
      queue: name,
      ...(await inspectWorkerConnection({
        isRunning: () => worker.isRunning(),
        key: worker.toKey('meta'),
        client: worker.getBackend().client,
        blockingClient: worker.getBackend().blockingClient,
      })),
    })),
  );

export const areWorkersConnected = async (): Promise<boolean> => {
  const workers = await getWorkerHealth();
  return workers.length > 0 && workers.every((worker) => worker.ready);
};

function createWorker(queueName: QueueNames, processor: (job: Job) => Promise<unknown>): Worker {
  const config = QUEUE_CONFIGS[queueName];
  const workerOptions: WorkerOptions = {
    connection: redisConnectionConfig,
    concurrency: config.concurrency,
    stalledInterval: config.stalledInterval,
    maxStalledCount: config.maxStalledCount,
    ...(config.limiter ? { limiter: config.limiter } : {}),
    ...(config.lockDuration === undefined ? {} : { lockDuration: config.lockDuration }),
  };

  const worker = new Worker(getQueueName(queueName), processor, workerOptions);

  // Observe both owned sockets. Logging a new probe client's health would hide
  // exactly the failure where a consumer has lost its blocking connection.
  const backend = worker.getBackend();
  for (const [kind, connection] of [
    ['command', backend.client],
    ['blocking', backend.blockingClient],
  ] as const) {
    if (!connection) continue;
    void connection.then(
      (client) => {
        for (const event of ['ready', 'close', 'reconnecting', 'end'] as const) {
          client.on(event, () => queueLogger.info({ queue: queueName, connection: kind, event }, 'Worker connection changed'));
        }
      },
      () => queueLogger.error({ queue: queueName, connection: kind }, 'Worker connection initialization failed'),
    );
  }

  worker.on('ready', () => queueLogger.info({ queue: queueName, concurrency: config.concurrency }, 'Worker ready'));
  worker.on('completed', (job) => {
    const duration = job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined;
    queueLogger.info({ jobId: job.id, name: job.name, queue: queueName, duration }, 'Job completed');
  });
  worker.on('failed', (job, error) =>
    queueLogger.error({ jobId: job?.id, name: job?.name, queue: queueName, error: error.message, attemptsMade: job?.attemptsMade }, 'Job failed'),
  );
  worker.on('error', (error) => queueLogger.error({ queue: queueName, error: error.message }, 'Worker error'));
  worker.on('stalled', (jobId) => queueLogger.warn({ jobId, queue: queueName }, 'Job stalled'));

  return worker;
}

async function cleanQueuesOnDevRestart(): Promise<void> {
  if (keys().NODE_ENV !== 'development') {
    return;
  }
  for (const [name, queue] of Object.entries(queues)) {
    const [waiting, active, delayed] = await Promise.all([queue.getWaitingCount(), queue.getActiveCount(), queue.getDelayedCount()]);
    if (waiting + active + delayed > 0) {
      queueLogger.warn({ queue: name, waiting, active, delayed }, 'Draining stale jobs (dev restart)');
      await Promise.all([queue.drain(), queue.clean(0, 0, 'active')]);
    }
  }
}

/** Boot a worker for every enabled queue that has a registered processor. */
export async function bootWorkers(processors: ProcessorRegistry): Promise<Worker[]> {
  await cleanQueuesOnDevRestart();
  for (const queueName of Object.values(QueueNames)) {
    if (!isQueueEnabled(queueName)) {
      continue;
    }
    const processor = processors[queueName] as ((job: Job) => Promise<unknown>) | undefined;
    if (!processor) {
      continue;
    }
    const worker = createWorker(queueName, processor);
    activeWorkers.push({ name: queueName, worker });
    queueLogger.info({ queue: queueName }, 'Worker started');
  }
  if (activeWorkers.length === 0) {
    queueLogger.warn('No workers started (empty registry or none enabled)');
  } else {
    queueLogger.info({ count: activeWorkers.length }, 'Workers boot complete');
  }
  return activeWorkers.map((e) => e.worker);
}

export async function closeWorkers(): Promise<void> {
  await Promise.all(
    activeWorkers.map(async ({ name, worker }) => {
      try {
        await worker.close();
      } catch (err) {
        queueLogger.error({ queue: name, err }, 'Error closing worker');
      }
    }),
  );
  activeWorkers.length = 0;
  queueLogger.info('All workers closed');
}

export const closeQueueEvents = _closeQueueEvents;
export const closeQueues = _closeQueues;
